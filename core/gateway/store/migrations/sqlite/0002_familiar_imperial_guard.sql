CREATE TABLE `approval_request` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_hash` text NOT NULL,
	`args_canonical_hash` text NOT NULL,
	`plan_summary` text,
	`caller_subject` text NOT NULL,
	`consumer_id` text,
	`tool_id` text NOT NULL,
	`tool_version` text,
	`status` text NOT NULL,
	`approver_subject` text,
	`decision_reason` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approval_request_status_created_idx` ON `approval_request` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_request_subject_created_idx` ON `approval_request` (`caller_subject`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_request_plan_hash_idx` ON `approval_request` (`plan_hash`);--> statement-breakpoint
CREATE TABLE `confirm_nonce` (
	`id` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`caller_subject` text NOT NULL,
	`tool_id` text NOT NULL,
	`tool_version` text,
	`plan_hash` text,
	`consumed_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`call_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `confirm_nonce_nonce_uq` ON `confirm_nonce` (`nonce`);--> statement-breakpoint
CREATE INDEX `confirm_nonce_expires_at_idx` ON `confirm_nonce` (`expires_at`);--> statement-breakpoint
CREATE INDEX `confirm_nonce_subject_tool_idx` ON `confirm_nonce` (`caller_subject`,`tool_id`);--> statement-breakpoint
CREATE TABLE `idempotency_record` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`caller_subject` text NOT NULL,
	`tool_id` text NOT NULL,
	`tool_version` text NOT NULL,
	`args_canonical_hash` text NOT NULL,
	`confirm_token_hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error_code` text,
	`call_id` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`scope_hours` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_record_key_uq` ON `idempotency_record` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idempotency_record_expires_at_idx` ON `idempotency_record` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idempotency_record_subject_tool_idx` ON `idempotency_record` (`caller_subject`,`tool_id`);