CREATE TABLE "consumer_usage_identity_mismatch" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumer_usage_identity_mismatch" ADD CONSTRAINT "consumer_usage_identity_mismatch_bucket_id_consumer_usage_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."consumer_usage_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_usage_identity_mismatch_uq" ON "consumer_usage_identity_mismatch" USING btree ("bucket_id");