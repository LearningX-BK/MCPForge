CREATE TABLE "consumer_usage_binding_type" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"binding_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_usage_bucket" (
	"id" text PRIMARY KEY NOT NULL,
	"consumer_id" text NOT NULL,
	"granularity" text NOT NULL,
	"bucket_start" text NOT NULL,
	"calls" integer NOT NULL,
	"writes" integer NOT NULL,
	"plans_minted" integer NOT NULL,
	"plans_confirmed" integer NOT NULL,
	"distinct_tools" integer NOT NULL,
	"distinct_binding_types" integer NOT NULL,
	"distinct_subjects" integer NOT NULL,
	"bytes_out" integer NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_usage_latency" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"latency_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_usage_refusal" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"error_code" text NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_usage_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"caller_subject" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_usage_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"tool_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumer_usage_binding_type" ADD CONSTRAINT "consumer_usage_binding_type_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_usage_latency" ADD CONSTRAINT "consumer_usage_latency_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_usage_refusal" ADD CONSTRAINT "consumer_usage_refusal_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_usage_subject" ADD CONSTRAINT "consumer_usage_subject_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_usage_tool" ADD CONSTRAINT "consumer_usage_tool_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_binding_type_uq" ON "consumer_usage_binding_type" USING btree ("bucket_id","binding_type");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_bucket_uq" ON "consumer_usage_bucket" USING btree ("consumer_id","granularity","bucket_start");--> statement-breakpoint
CREATE INDEX "consumer_usage_bucket_granularity_idx" ON "consumer_usage_bucket" USING btree ("granularity","bucket_start");--> statement-breakpoint
CREATE INDEX "consumer_usage_latency_bucket_idx" ON "consumer_usage_latency" USING btree ("bucket_id","latency_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_refusal_uq" ON "consumer_usage_refusal" USING btree ("bucket_id","error_code");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_subject_uq" ON "consumer_usage_subject" USING btree ("bucket_id","caller_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_tool_uq" ON "consumer_usage_tool" USING btree ("bucket_id","tool_id");