CREATE TABLE "anomaly_event" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" text NOT NULL,
	"consumer_id" text NOT NULL,
	"detector_id" text NOT NULL,
	"severity" text NOT NULL,
	"window" text NOT NULL,
	"observed" text NOT NULL,
	"threshold" text NOT NULL,
	"state" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomaly_event_audit_call" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"call_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomaly_event_audit_call" ADD CONSTRAINT "anomaly_event_audit_call_event_id_anomaly_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."anomaly_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_event_audit_call" ADD CONSTRAINT "anomaly_event_audit_call_call_id_audit_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."audit_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anomaly_event_consumer_ts_idx" ON "anomaly_event" USING btree ("consumer_id","ts");--> statement-breakpoint
CREATE INDEX "anomaly_event_detector_ts_idx" ON "anomaly_event" USING btree ("detector_id","ts");--> statement-breakpoint
CREATE INDEX "anomaly_event_state_ts_idx" ON "anomaly_event" USING btree ("state","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "anomaly_event_audit_call_uq" ON "anomaly_event_audit_call" USING btree ("event_id","call_id");--> statement-breakpoint
CREATE INDEX "anomaly_event_audit_call_call_idx" ON "anomaly_event_audit_call" USING btree ("call_id");