# s.at — Short, self-destructing pastes

A short-URL pastebin built with **Next.js 16 (App Router) + TypeScript + Drizzle ORM + PostgreSQL**. Paste text or files, get a short typable URL (e.g. `s.at/RcmR6m`), and decide how long it lives — or let it self-destruct after one read.

## Features

- **Short URLs** — auto-generated 6-character base62 codes; the short URL renders the content directly.
- **Server-side encryption** — AES-256-GCM. Each paste gets a random 256-bit key that is wrapped ("encrypted at rest") with a `PASTE_MASTER_KEY` before being stored, so a raw DB dump is not plaintext-readable.
- **Optional password protection** — content key derived with PBKDF2-SHA256 (210,000 iterations, per-paste random salt).
- **Expiration** — 5 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h, 1 d, 3 d.
- **Burn after reading** — deletes the paste immediately after it is first revealed; an explicit "reveal" step prevents preview bots from burning pastes. (Burn-after-read pastes cannot have file attachments.)
- **Encrypted file attachments** — up to 20 files per paste, 50 MB each, 100 MB total. Files are encrypted client-side (AES-GCM with the paste's content key) before being uploaded, then stored in Vercel Blob; the server decrypts on download.
- **Rate limiting** — create + read limits via Vercel KV / Upstash Redis (per-IP, sliding window).
- **Hardened security headers** — strict CSP (`nonce` + `strict-dynamic`, `script-src-attr 'none'`), Referrer-Policy, nosniff, `X-Frame-Options: DENY`, Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, HSTS.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.3 (App Router), TypeScript |
| UI | Tailwind CSS v4, Geist fonts (`next/font`), lucide-react icons |
| ORM | Drizzle (+ postgres.js driver, drizzle-kit migrations) |
| Database | PostgreSQL (remote) |
| Crypto | Node `crypto` / WebCrypto — AES-256-GCM, PBKDF2-SHA256, master-key wrapping |
| Short codes | nanoid (base62, length 6) |
| File storage | Vercel Blob (`@vercel/blob`) |
| Rate limiting | @upstash/ratelimit + @upstash/redis |
| Validation | Zod |
| Deploy | Vercel (+ Vercel Cron for cleanup) |

## Getting started

### 1. Install

```bash
pnpm install
```

> This repo uses **pnpm** as the package manager and bleeding-edge tooling (TypeScript 7, ESLint 10). `pnpm lint` may be incompatible with the current `typescript-eslint` until it supports TS 7; typecheck (`pnpm build` / `npx tsc --noEmit`) is the source of truth.

### 2. Configure environment

Create `.env.local` (see `.env.example`):

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
PASTE_MASTER_KEY=<long random string; e.g. `openssl rand -hex 32`>
APP_URL=http://localhost:3000
KV_REST_API_URL=            # optional — rate limiting (Vercel KV / Upstash)
KV_REST_API_TOKEN=
BLOB_READ_WRITE_TOKEN=      # optional — file attachments (Vercel Blob store)
CRON_SECRET=                # guards the cleanup endpoint
```

> **PASTE_MASTER_KEY must stay constant** across deploys, or stored pastes can no longer be decrypted. Keep it secret.

### 3. Migrate the database

```bash
pnpm drizzle-kit generate   # create a migration from schema changes
pnpm drizzle-kit migrate    # apply migrations to the DB
```

### 4. Run

```bash
pnpm dev
```

Open http://localhost:3000.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build (includes typecheck) |
| `pnpm start` | Start production server |
| `pnpm lint` | ESLint (may require pinning TS to <7) |
| `npx tsc --noEmit` | Type-check only |
| `pnpm drizzle-kit generate` | Generate DB migration |
| `pnpm drizzle-kit migrate` | Apply DB migrations |
| `pnpm drizzle-kit push` | Dev-only: push schema without migration |

## Architecture

### Flow

1. **Create** — `POST /api/pastes` validates input with Zod, encrypts text with AES-256-GCM using a random key (or a PBKDF2-derived key when password-protected), wraps the key with the master key, and stores ciphertext + metadata under a generated short code. File attachments are encrypted client-side, uploaded to Vercel Blob via `/api/pastes/upload-token`, and their metadata (plus per-file IV/auth tag) is stored in an `attachments` table. Returns `{ code, url }`.
2. **Read** — the user opens `/[code]`. For password-protected pastes a gate is shown; the client posts the password to `/api/pastes/[code]/verify`. For all other pastes, the client posts to `/api/pastes/[code]/reveal`. The server unwraps/derives the key, decrypts, enforces expiry and burn-after-read, and returns the plaintext.
3. **Download files** — `GET /api/pastes/[code]/files/[id]` fetches the encrypted blob, decrypts server-side, and streams it back with the original filename. On burn/expiry cleanup the blob objects are deleted as well.

### Data model

```
pastes
  code           varchar(12) PK     # short URL code
  ciphertext     bytea              # AES-GCM ciphertext (text content)
  iv             bytea              # GCM IV
  auth_tag       bytea              # GCM auth tag
  key_wrapped    bytea              # content key, encrypted with PASTE_MASTER_KEY
  salt           bytea              # PBKDF2 salt (password-protected only)
  kdf_iterations int
  burn_after_read boolean
  consumed       boolean
  created_at     timestamptz
  expires_at     timestamptz
  views          int

attachments
  id            uuid PK
  paste_code    varchar(12) FK → pastes.code (cascade delete)
  filename      text
  mime          text
  size          int
  compression   text               # "deflate" | "none"
  blob_path     text               # Vercel Blob path
  iv            bytea              # per-file GCM IV
  auth_tag      bytea              # per-file GCM auth tag
  created_at    timestamptz
```

### Rate limiting

- Create: 20 / 10 s per IP
- Read: 60 / 60 s per IP

When KV env vars are absent, rate limiting is disabled (fine for local dev).

### Cleanup

`/api/cron/cleanup` runs daily (midnight UTC, configured in `vercel.json`) and deletes expired pastes — including their attachment blobs. It is guarded by a `Bearer CRON_SECRET` check. Expiry is also enforced lazily on every read.

## Security notes

- This is a **server-side** encryption model: the server holds the master key and can decrypt content. It is NOT zero-knowledge like PrivateBin — that trade-off buys short, typable URLs.
- Ciphertext is encrypted at rest with a per-paste key that is itself wrapped by a master key stored only in env. File blobs are encrypted client-side before they ever reach object storage.
- Content is always rendered through React's text-escaping; the only `dangerouslySetInnerHTML` usages are small nonce'd inline `<head>` scripts (theme init).
- The XSS defense is the strict CSP: `nonce` + `strict-dynamic`, no `unsafe-inline`/`unsafe-eval`, `script-src-attr 'none'`.

## Deployment (Vercel)

1. Push to GitHub and import into Vercel, or `vercel --prod`.
2. Set all env vars in the Vercel project settings, including `BLOB_READ_WRITE_TOKEN` (create a private Blob store in the Vercel Storage tab to enable file attachments).
3. Keep `PASTE_MASTER_KEY` identical on every environment.
4. Cron runs automatically via `vercel.json`.

## License

[GPL-3.0](LICENSE) — Copyright (C) 2026 abhigit23.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
