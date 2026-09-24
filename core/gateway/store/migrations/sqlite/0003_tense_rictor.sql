ALTER TABLE `audit_retention_gate` ADD `deployment_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `cutoff_ts` text NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `deleted_count` integer;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `boundary_row_hash` text;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `attestation_call_id` text;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `actor_subject` text NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_retention_gate` ADD `consumer_id` text NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_retention_gate_open_idx` ON `audit_retention_gate` (`closed_at`);--> statement-breakpoint
CREATE INDEX `audit_retention_gate_deployment_idx` ON `audit_retention_gate` (`deployment_id`,`opened_at`);