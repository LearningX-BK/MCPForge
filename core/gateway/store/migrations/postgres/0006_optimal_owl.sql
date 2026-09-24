ALTER TABLE "audit_call" ADD COLUMN "reversal_tool_id" text;--> statement-breakpoint
CREATE INDEX "audit_call_reverses_call_id_idx" ON "audit_call" USING btree ("reverses_call_id");