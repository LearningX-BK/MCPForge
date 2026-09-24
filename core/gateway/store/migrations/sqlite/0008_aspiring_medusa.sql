CREATE TABLE `anomaly_event` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`consumer_id` text NOT NULL,
	`detector_id` text NOT NULL,
	`severity` text NOT NULL,
	`window` text NOT NULL,
	`observed` text NOT NULL,
	`threshold` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anomaly_event_consumer_ts_idx` ON `anomaly_event` (`consumer_id`,`ts`);--> statement-breakpoint
CREATE INDEX `anomaly_event_detector_ts_idx` ON `anomaly_event` (`detector_id`,`ts`);--> statement-breakpoint
CREATE INDEX `anomaly_event_state_ts_idx` ON `anomaly_event` (`state`,`ts`);--> statement-breakpoint
CREATE TABLE `anomaly_event_audit_call` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`call_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `anomaly_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `audit_call`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anomaly_event_audit_call_uq` ON `anomaly_event_audit_call` (`event_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `anomaly_event_audit_call_call_idx` ON `anomaly_event_audit_call` (`call_id`);