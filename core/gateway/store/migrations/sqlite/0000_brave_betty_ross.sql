CREATE TABLE `store_heartbeat` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`store_kind` text NOT NULL,
	`observed_at` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `store_heartbeat_observed_at_idx` ON `store_heartbeat` (`observed_at`);