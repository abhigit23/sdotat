ALTER TABLE "attachments" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "mime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "meta" "bytea";--> statement-breakpoint
ALTER TABLE "pastes" ADD COLUMN "compression" text DEFAULT 'none' NOT NULL;