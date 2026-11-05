CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid,
	"to_address" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_notes" ALTER COLUMN "blob_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "change_orders" ADD COLUMN "evidence_blob_key" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "assumptions" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "drafted_by" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "content_type" text DEFAULT 'image/jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "merchant_name" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "total_cents" bigint;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;