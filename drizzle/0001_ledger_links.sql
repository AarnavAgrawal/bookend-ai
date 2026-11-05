ALTER TABLE "change_orders" DROP CONSTRAINT "change_orders_trigger_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "job_funds" ADD COLUMN "limit_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ramp_connections" ADD COLUMN "fund_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "change_order_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" DROP COLUMN "trigger_transaction_id";