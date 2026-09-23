import { eq, sql, inArray, and } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Paste, NewPaste, Attachment, NewAttachment } from "@/db/schema";
import { shortId } from "./ids";
import { mapWithConcurrency } from "./map-concurrency";

const EXPIRY_MS: Record<string, number> = {
  "5min": 5 * 60 * 1000,
  "10min": 10 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
};

export type CreatePasteArgs = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyWrapped: Buffer;
  salt?: Buffer | null;
  burnAfterRead: boolean;
  expiresIn: string;
};

export function getExpiryDate(expiresIn: string): Date | null {
  const ms = EXPIRY_MS[expiresIn];
  return ms ? new Date(Date.now() + ms) : null;
}

export async function createPaste(args: CreatePasteArgs): Promise<Paste> {
  if (!db) throw new Error("Database not configured");
  const d = db;
  const expiresAt = getExpiryDate(args.expiresIn);

  const MAX_CODE_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const row: NewPaste = {
      code: shortId(),
      ciphertext: args.ciphertext,
      iv: args.iv,
      authTag: args.authTag,
      keyWrapped: args.keyWrapped,
      salt: args.salt ?? null,
      burnAfterRead: args.burnAfterRead,
      consumed: false,
      expiresAt,
      views: 0,
    };

    try {
      const rows = await d.insert(schema.pastes).values(row).returning();
      return rows[0];
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") throw e;
    }
  }

  throw new Error("Failed to generate a unique code");
}

export async function getPasteByCode(code: string): Promise<Paste | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.pastes)
    .where(eq(schema.pastes.code, code))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The subset of a paste needed to render the `/[code]` gate page. Deliberately
 * excludes the large columns (`ciphertext`, `iv`, `authTag`, `keyWrapped`) so
 * the page doesn't transfer up to 1 MB of unused bytes per request.
 */
export type PasteGate = Pick<
  Paste,
  "code" | "salt" | "expiresAt" | "consumed" | "burnAfterRead"
>;

export async function getPasteGateByCode(
  code: string
): Promise<PasteGate | null> {
  if (!db) return null;
  const rows = await db
    .select({
      code: schema.pastes.code,
      salt: schema.pastes.salt,
      expiresAt: schema.pastes.expiresAt,
      consumed: schema.pastes.consumed,
      burnAfterRead: schema.pastes.burnAfterRead,
    })
    .from(schema.pastes)
    .where(eq(schema.pastes.code, code))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Deletes a paste row. Returns true if a row was removed.
 */
export async function deletePaste(code: string): Promise<boolean> {
  if (!db) return false;
  const res = await db
    .delete(schema.pastes)
    .where(eq(schema.pastes.code, code));
  return Number(res.count) > 0;
}

/**
 * Increments the view counter for a paste.
 */
export async function incrementViews(code: string): Promise<void> {
  if (!db) return;
  await db
    .update(schema.pastes)
    .set({ views: sql`${schema.pastes.views} + 1` })
    .where(eq(schema.pastes.code, code));
}

/**
 * Atomically claims a burn-after-read paste for viewing: flips `consumed` to
 * true only if it is still unread. Returns true if this caller won the claim
 * and may reveal the content, false if another request already consumed it.
 */
export async function claimPasteForView(code: string): Promise<boolean> {
  if (!db) return false;
  const res = await db
    .update(schema.pastes)
    .set({ consumed: true })
    .where(
      and(
        eq(schema.pastes.code, code),
        eq(schema.pastes.burnAfterRead, true),
        eq(schema.pastes.consumed, false)
      )
    );
  return Number(res.count) > 0;
}

/**
 * Removes all expired pastes and their attachment blobs. Used by the cleanup
 * job. Returns the number of pastes deleted.
 */
export async function deleteExpiredPastes(): Promise<number> {
  if (!db) return 0;
  const BATCH_SIZE = 50;
  let totalDeleted = 0;

  while (true) {
    const expired = await db
      .select({ code: schema.pastes.code })
      .from(schema.pastes)
      .where(sql`${schema.pastes.expiresAt} < now()`)
      .limit(BATCH_SIZE);

    if (expired.length === 0) break;

    for (const p of expired) {
      await deleteAttachmentsBlobs(p.code);
    }

    const res = await db
      .delete(schema.pastes)
      .where(inArray(schema.pastes.code, expired.map((p) => p.code)));

    totalDeleted += Number(res.count);
  }

  return totalDeleted;
}

export async function getAttachmentsByCode(code: string): Promise<Attachment[]> {
  if (!db) return [];
  return db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.pasteCode, code));
}

export async function getAttachmentById(
  code: string,
  id: string
): Promise<Attachment | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.attachments)
    .where(
      sql`${schema.attachments.id} = ${id}::uuid AND ${schema.attachments.pasteCode} = ${code}`
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function addAttachments(
  rows: Array<Omit<NewAttachment, "id" | "createdAt">>
): Promise<void> {
  if (!db) return;
  if (rows.length === 0) return;
  await db.insert(schema.attachments).values(rows);
}

/**
 * Deletes the Vercel Blob object backing a single attachment. Returns true if
 * the blob was deleted, false if no token is configured / blob missing.
 * The blob SDK is imported lazily to keep the create/read paste route bundles
 * small (it pulls in a large dependency graph).
 */
export async function deleteBlob(blobPath: string): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    const { del } = await import("@vercel/blob");
    await del(blobPath);
    return true;
  } catch {
    return false;
  }
}

const BLOB_DELETE_CONCURRENCY = 5;

/**
 * Deletes all blob objects for a paste's attachments. Returns the count of
 * blobs deleted. Attachment rows are removed via the FK cascade.
 */
export async function deleteAttachmentsBlobs(code: string): Promise<number> {
  if (!db) return 0;
  const attachments = await getAttachmentsByCode(code);
  if (attachments.length === 0) return 0;
  let deleted = 0;
  await mapWithConcurrency(
    attachments,
    BLOB_DELETE_CONCURRENCY,
    async (a) => {
      if (await deleteBlob(a.blobPath)) deleted++;
    }
  );
  return deleted;
}
