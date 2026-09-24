CREATE TABLE `consumer_usage_identity_mismatch` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`count` integer NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `consumer_usage_bucket`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumer_usage_identity_mismatch_uq` ON `consumer_usage_identity_mismatch` (`bucket_id`);