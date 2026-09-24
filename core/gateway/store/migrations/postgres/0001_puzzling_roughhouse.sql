CREATE TABLE "audit_call" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" text NOT NULL,
	"correlation_id" text,
	"session_id" text,
	"parent_call_id" text,
	"caller_subject" text NOT NULL,
	"caller_display" text,
	"caller_idp" text,
	"caller_amr" text,
	"caller_roles" text,
	"on_behalf_of" text,
	"consumer_id" text NOT NULL,
	"consumer_record_sha" text,
	"consumer_auth_method" text,
	"consumer_session_id" text,
	"human_in_the_loop" boolean NOT NULL,
	"tool_id" text NOT NULL,
	"tool_version" text,
	"manifest_sha" text,
	"server_id" text,
	"package_id" text,
	"binding_type" text,
	"archetype" text,
	"verb" text,
	"entity" text,
	"sensitivity_class" text,
	"is_write" boolean NOT NULL,
	"target_system" text,
	"target_env" text,
	"target_object" text,
	"deployment_id" text NOT NULL,
	"gateway_version" text,
	"bundle_version" text,
	"phase" text NOT NULL,
	"confirm_token_hash" text,
	"plan_hash" text,
	"args_hash" text,
	"idempotency_key" text,
	"replayed" boolean,
	"args_redacted" text,
	"result_keys" text,
	"row_count" integer,
	"bytes_out" integer,
	"outcome" text NOT NULL,
	"error_code" text,
	"error_message_agent" text,
	"denied_by_rule" text,
	"identity_carrying" boolean,
	"target_identity_observed" text,
	"identity_match" boolean,
	"compensating_control" text,
	"reversal_class" text,
	"reverses_call_id" text,
	"reversed_by_call_id" text,
	"latency_ms_total" integer,
	"latency_ms_gateway" integer,
	"latency_ms_target" integer,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_call_role" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_credential_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"secret_ref" text NOT NULL,
	"version" text
);
--> statement-breakpoint
CREATE TABLE "audit_result_key" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"key_name" text NOT NULL,
	"key_value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_retention_gate" (
	"id" text PRIMARY KEY NOT NULL,
	"opened_at" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_call_role" ADD CONSTRAINT "audit_call_role_call_id_audit_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."audit_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_credential_ref" ADD CONSTRAINT "audit_credential_ref_call_id_audit_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."audit_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_result_key" ADD CONSTRAINT "audit_result_key_call_id_audit_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."audit_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_call_subject_target_ts_idx" ON "audit_call" USING btree ("caller_subject","target_system","ts");--> statement-breakpoint
CREATE INDEX "audit_call_plan_hash_phase_idx" ON "audit_call" USING btree ("plan_hash","phase");--> statement-breakpoint
CREATE INDEX "audit_call_deployment_id_idx" ON "audit_call" USING btree ("deployment_id","id");--> statement-breakpoint
CREATE INDEX "audit_call_consumer_ts_idx" ON "audit_call" USING btree ("consumer_id","ts");--> statement-breakpoint
CREATE INDEX "audit_call_idempotency_key_idx" ON "audit_call" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_call_chain_link_uq" ON "audit_call" USING btree ("deployment_id","prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_call_row_hash_uq" ON "audit_call" USING btree ("row_hash");--> statement-breakpoint
CREATE INDEX "audit_call_role_role_id_idx" ON "audit_call_role" USING btree ("role_id","call_id");--> statement-breakpoint
CREATE INDEX "audit_call_role_call_id_idx" ON "audit_call_role" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "audit_credential_ref_secret_ref_idx" ON "audit_credential_ref" USING btree ("secret_ref","version");--> statement-breakpoint
CREATE INDEX "audit_credential_ref_call_id_idx" ON "audit_credential_ref" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "audit_result_key_value_name_idx" ON "audit_result_key" USING btree ("key_value","key_name");--> statement-breakpoint
CREATE INDEX "audit_result_key_call_id_idx" ON "audit_result_key" USING btree ("call_id");