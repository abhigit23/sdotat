import {
  pgTable,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  uuid,
  text,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Postgres `bytea` column mapped to Node Buffer. The postgres.js driver
 * represents binary columns as Buffer by default.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: Buffer) {
    return Buffer.from(value);
  },
});

export const pastes = pgTable(
  "pastes",
  {
    code: varchar("code", { length: 12 }).primaryKey(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyWrapped: bytea("key_wrapped").notNull(),
    salt: bytea("salt"),
    // "deflate" when the text was compressed before encryption.
    compression: text("compression").notNull().default("none"),
    burnAfterRead: boolean("burn_after_read").default(false).notNull(),
    consumed: boolean("consumed").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    views: integer("views").default(0).notNull(),
  },
  (table) => [index("pastes_expires_at_idx").on(table.expiresAt)]
).enableRLS();

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pasteCode: varchar("paste_code", { length: 12 })
      .notNull()
      .references(() => pastes.code, { onDelete: "cascade" }),
    // Filename and MIME type, encrypted with the paste's content key (see
    // sealAttachmentMeta).
    meta: bytea("meta").notNull(),
    size: integer("size").notNull(),
    compression: text("compression").notNull().default("deflate"),
    blobPath: text("blob_path").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
  },
  (table) => [
    index("attachments_paste_code_idx").on(table.pasteCode),
    // One row per blob, so a paste can't claim another paste's file. Also
    // serves the orphan sweep's blob_path lookups.
    uniqueIndex("attachments_blob_path_idx").on(table.blobPath),
  ]
).enableRLS();

export type Paste = typeof pastes.$inferSelect;
export type NewPaste = typeof pastes.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
