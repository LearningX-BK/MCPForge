ALTER TABLE "audit_retention_gate" ADD COLUMN "deployment_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "cutoff_ts" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "closed_at" text;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "deleted_count" integer;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "boundary_row_hash" text;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "attestation_call_id" text;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "actor_subject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_retention_gate" ADD COLUMN "consumer_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_retention_gate_open_idx" ON "audit_retention_gate" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "audit_retention_gate_deployment_idx" ON "audit_retention_gate" USING btree ("deployment_id","opened_at");