CREATE TABLE `runtime_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	`until` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`audit_call_id` text,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runtime_flags_active_idx` ON `runtime_flags` (`active`,`scope`,`target`);--> statement-breakpoint
CREATE INDEX `runtime_flags_scope_target_idx` ON `runtime_flags` (`scope`,`target`);