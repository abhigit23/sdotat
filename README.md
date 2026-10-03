# s.at — Short, self-destructing pastes

A short-URL pastebin built with **Next.js 16 (App Router) + TypeScript + Drizzle ORM + PostgreSQL**. Paste text or files, get a short typable URL (e.g. `s.at/RcmR6m`), and decide how long it lives — or let it self-destruct after one read.

## Features

- **Short URLs** — auto-generated 6-character base62 codes. Open a paste from its link, or type a code / paste a link into the "Open" box on the home page.
- **Server-side encryption** — AES-256-GCM. Each paste gets a random 256-bit key that is wrapped ("encrypted at rest") with a `PASTE_MASTER_KEY` before being stored, so a raw DB dump is not plaintext-readable. Text is deflate-compressed before encryption when that makes it smaller.
- **Optional password protection** — content key derived in the browser with PBKDF2-SHA256 (210,000 iterations, per-paste random salt). The server never receives or derives the password — only the derived key. A "generate" button creates a random, easy-to-read password (`k7Qm-Xe3P-vN9c-Tr4W`, ~93 bits), and the editor warns about weak ones. Failed attempts are limited per paste (see Rate limiting).
- **Expiration** — 5 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h, 1 d, 3 d. The viewer shows a live "Expires in …" countdown.
- **Burn after reading** — deleted as soon as it is first revealed. An explicit "reveal" step prevents link-preview bots from burning pastes, an atomic claim stops two simultaneous viewers from both reading it, and the viewer warns before you leave the page without copying or downloading the text. (Burn-after-read pastes cannot have file attachments.)
- **Encrypted file attachments** — up to 20 files per paste, 50 MB each, 100 MB total; files-only pastes (no text) are allowed. Add files with the picker, drag-and-drop anywhere on the page, or paste from the clipboard. Files are compressed (when smaller) and encrypted client-side with the paste's content key, then uploaded straight to Vercel Blob; filenames and MIME types are stored encrypted too. The server decrypts on download.
- **Resilient uploads** — files over 8 MB use Vercel Blob multipart uploads (8 MB parts, retried individually), so a dropped connection on a slow or mobile network retries one part instead of restarting the file. Overall progress is shown and uploads can be cancelled.
- **Viewer tools** — wrap long lines, line numbers (pastes up to 5,000 lines), download text as `.txt`, copy, per-file download progress, and "Download all (.zip)" for multi-file pastes. The share button uses the native share sheet where available and falls back to copying the link.
- **UI** — light / dark / system theme toggle, slim theme-aware scrollbars, and a no-scroll responsive layout that compacts itself on short screens and landscape phones.
- **Rate limiting** — create + read limits via Vercel KV / Upstash Redis (per-IP, sliding window).
- **Hardened security headers** — strict CSP (`nonce` + `strict-dynamic`, `script-src-attr 'none'`), Referrer-Policy, nosniff, `X-Frame-Options: DENY`, Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy. File downloads are always served as `application/octet-stream` with a sandboxing CSP.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.3 (App Router), TypeScript |
| UI | Tailwind CSS v4, Geist fonts (`next/font`), lucide-react icons |
| ORM | Drizzle (+ postgres.js driver, drizzle-kit migrations) |
| Database | PostgreSQL on Supabase (RLS enabled, Data API grants revoked) |
| Crypto | Node `crypto` / WebCrypto — AES-256-GCM, PBKDF2-SHA256, master-key wrapping |
| Compression | `zlib` deflate (server, paste text) / `CompressionStream` (browser, files) |
| Short codes | nanoid (base62, length 6) |
| File storage | Vercel Blob (`@vercel/blob`, private store, client uploads) |
| Rate limiting | @upstash/ratelimit + @upstash/redis |
| Validation | Zod |
| Deploy | Vercel, region `bom1` (+ Vercel Cron for cleanup) |

## Getting started

### 1. Install

```bash
pnpm install
```

> This repo uses **pnpm** as the package manager and bleeding-edge tooling (TypeScript 7, ESLint 10). `pnpm lint` currently fails because `typescript-eslint` does not support TS 7 yet; typecheck (`pnpm build` / `npx tsc --noEmit`) is the source of truth.

### 2. Configure environment

Create `.env.local`:

```env
POSTGRES_URL=postgresql://user:password@pooler.host:6543/dbname   # pooled (Supabase/Neon)
POSTGRES_URL_NON_POOLING=postgresql://user:password@direct.host:5432/dbname   # for migrations
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

> `drizzle-kit` does not read `.env.local` — set `POSTGRES_URL_NON_POOLING` (or `POSTGRES_URL`) in the shell before running `pnpm drizzle-kit migrate`.

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
| `pnpm lint` | ESLint (fails until `typescript-eslint` supports TS 7) |
| `npx tsc --noEmit` | Type-check only |
| `pnpm drizzle-kit generate` | Generate DB migration |
| `pnpm drizzle-kit migrate` | Apply DB migrations |
| `pnpm drizzle-kit push` | Dev-only: push schema without migration |

## Architecture

### Flow

1. **Create** — the client derives a content key with PBKDF2-SHA256 in the browser for password-protected pastes, or generates a random WebCrypto key when there are file attachments, and sends it (base64) with the paste; for plain text-only pastes the server generates a fresh random key. Files are uploaded **before** the paste is created: each one is compressed, encrypted, and uploaded to Vercel Blob via a client token from `/api/pastes/upload-token` (pathnames must match `files/<uuid>`; files over 8 MB use multipart). `POST /api/pastes` then validates input with Zod, compresses + encrypts the text with AES-256-GCM, wraps the key with the master key, and inserts the row under a short code (retrying on the rare code collision — no preliminary existence check). Attachment rows store the blob path, size, per-file IV/auth tag, and the filename/MIME sealed with the content key. If the request is rejected or fails, the uploaded blobs are deleted. Returns `{ code, url }`.
2. **Read** — the user opens `/[code]`. For password-protected pastes a gate is shown; the client re-derives the key in the browser (PBKDF2 with the stored per-paste salt) and posts `{ contentKey }` to `/api/pastes/[code]/verify`. The server unwraps the stored key and compares it to the submitted one with a constant-time check (`timingSafeEqual`) — no password or KDF ever runs on the server. For all other pastes, the user clicks "View" and the client posts to `/api/pastes/[code]/reveal`. The server unwraps the key, decrypts, enforces expiry and burn-after-read, and returns the plaintext plus decrypted attachment metadata.
3. **Burn** — for burn-after-read pastes, the server atomically flips `consumed` from `false` to `true` before responding; only the request that wins the flip gets the content, and any concurrent request gets `410 Gone`. The row is deleted after the response is sent.
4. **Download files** — `GET /api/pastes/[code]/files/[id]` streams the encrypted blob through AES-GCM decryption (and inflate, if compressed) back to the client with the original filename. Password-protected pastes require the `X-Paste-Key` header (the client's derived key), checked with the same constant-time comparison. Downloads run at most 3 at a time; "Download all" zips the files in the browser.

### Data model

```
pastes
  code            varchar(12) PK     # short URL code
  ciphertext      bytea              # AES-GCM ciphertext (text content)
  iv              bytea              # GCM IV
  auth_tag        bytea              # GCM auth tag
  key_wrapped     bytea              # content key, encrypted with PASTE_MASTER_KEY
  salt            bytea              # PBKDF2 salt (password-protected only)
  compression     text               # "deflate" | "none" (text compressed before encryption)
  burn_after_read boolean
  consumed        boolean            # burn-after-read: already claimed by a viewer
  expires_at      timestamptz        # indexed
  views           int

attachments
  id            uuid PK
  paste_code    varchar(12) FK → pastes.code (cascade delete), indexed
  meta          bytea              # filename + MIME, encrypted with the content key
  size          int                # original (decrypted) size in bytes
  compression   text               # "deflate" | "none"
  blob_path     text UNIQUE        # Vercel Blob path; one paste per blob
  iv            bytea              # per-file GCM IV
  auth_tag      bytea              # per-file GCM auth tag
```

Both tables have row-level security enabled, and the Supabase `anon` / `authenticated` roles have no grants. The app connects as the table owner.

### Rate limiting

- Create paste: 20 / 10 s per IP
- Upload tokens (one per file): 30 / 10 min per IP
- Read (reveal, verify, file downloads): 60 / 60 s per IP
- Password attempts: 10 failures per paste per hour, counted across all IPs and across `/verify` and file downloads. Once locked, even the correct password gets `429 Too many attempts. Try again later.` (no count or `Retry-After` is revealed) until the window ends.
- Upload quota: 300 MB of uploads per IP per UTC day. The client declares each encrypted file's size when requesting its upload token; the server counts it against the quota in Redis and issues a token capped at exactly that size, so Blob rejects anything larger.

When KV env vars are absent, rate limiting and the upload quota are disabled (fine for local dev).

### Cleanup

`/api/cron/cleanup` runs daily (midnight UTC, configured in `vercel.json`). It deletes expired pastes with their attachment blobs, then sweeps **orphaned blobs** — files that were uploaded but never attached to a paste (tab closed, request failed) and are older than one hour. It is guarded by a `Bearer CRON_SECRET` check. Expiry is also enforced lazily on every read.

## Security notes

- This is a **server-side** encryption model: the server holds the master key and can decrypt content. It is NOT zero-knowledge like PrivateBin — that trade-off buys short, typable URLs.
- Ciphertext is encrypted at rest with a per-paste key that is itself wrapped by a master key stored only in env. File blobs (and their names) are encrypted client-side before they ever reach object storage.
- Content is always rendered through React's text-escaping; the only `dangerouslySetInnerHTML` usages are a few small nonce'd inline `<head>` scripts (a Trusted Types polyfill, theme init, and the `ld+json` structured data).
- The XSS defense is the strict CSP: `nonce` + `strict-dynamic`, no `unsafe-inline`/`unsafe-eval` in production, `script-src-attr 'none'`.
- Uploaded MIME types are never trusted for serving: downloads are `application/octet-stream` with `Content-Security-Policy: default-src 'none'; sandbox`.
- HSTS is not set by the app; Vercel's edge adds it on deployed domains.

## Deployment (Vercel)

1. Push to GitHub and import into Vercel, or `vercel --prod`.
2. Set all env vars in the Vercel project settings, including `BLOB_READ_WRITE_TOKEN` (create a private Blob store in the Vercel Storage tab to enable file attachments).
3. Keep `PASTE_MASTER_KEY` identical on every environment.
4. Cron runs automatically via `vercel.json`; functions are pinned to the `bom1` region (Mumbai) in `vercel.json`.

## License

[GPL-3.0](LICENSE) — Copyright (C) 2026 abhigit23.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
