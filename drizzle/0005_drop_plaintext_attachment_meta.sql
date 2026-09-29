ALTER TABLE "attachments" ALTER COLUMN "meta" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "filename";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "mime";