CREATE TABLE "auth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" text NOT NULL,
	"idle_expires_at" text NOT NULL,
	"spent_at" text,
	"replaced_by" text
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"provider_id" text NOT NULL,
	"amr" text NOT NULL,
	"created_at" text NOT NULL,
	"absolute_expires_at" text NOT NULL,
	"revoked_at" text,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "auth_refresh_token" ADD CONSTRAINT "auth_refresh_token_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_token_hash_uq" ON "auth_refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_refresh_token_session_idx" ON "auth_refresh_token" USING btree ("session_id","issued_at");--> statement-breakpoint
CREATE INDEX "auth_session_subject_created_idx" ON "auth_session" USING btree ("subject","created_at");--> statement-breakpoint
CREATE INDEX "auth_session_absolute_expires_idx" ON "auth_session" USING btree ("absolute_expires_at");