ALTER TABLE `audit_call` ADD `reversal_tool_id` text;--> statement-breakpoint
CREATE INDEX `audit_call_reverses_call_id_idx` ON `audit_call` (`reverses_call_id`);