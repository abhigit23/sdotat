ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pastes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The app connects as the table owner (postgres), which bypasses RLS. Also
-- strip Supabase's default Data API grants so anon/authenticated can't touch
-- these tables even if RLS is ever disabled, nor any table created later.
REVOKE ALL ON "pastes", "attachments" FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
DROP INDEX "pastes_created_at_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_blob_path_idx" ON "attachments" USING btree ("blob_path");--> statement-breakpoint
-- Ciphertext is incompressible; skip TOAST's futile compression attempts.
ALTER TABLE "pastes" ALTER COLUMN "ciphertext" SET STORAGE EXTERNAL;
