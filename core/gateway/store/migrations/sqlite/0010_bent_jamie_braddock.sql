CREATE TABLE `consumption_edge` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`binding_type` text,
	`last_call_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`call_count` integer NOT NULL,
	`write_count` integer NOT NULL,
	FOREIGN KEY (`last_call_id`) REFERENCES `audit_call`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_edge_uq` ON `consumption_edge` (`deployment_id`,`consumer_id`,`tool_id`);--> statement-breakpoint
CREATE INDEX `consumption_edge_tool_idx` ON `consumption_edge` (`tool_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `consumption_edge_consumer_idx` ON `consumption_edge` (`consumer_id`,`last_seen_at`);