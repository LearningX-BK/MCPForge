CREATE TABLE `local_user` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`active` integer NOT NULL,
	`password_hash` text NOT NULL,
	`password_algorithm` text NOT NULL,
	`password_updated_at` text NOT NULL,
	`totp_secret` text,
	`totp_confirmed_at` text,
	`totp_last_counter` integer,
	`failed_attempts` integer NOT NULL,
	`locked_until` text,
	`last_authenticated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_user_subject_uq` ON `local_user` (`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `local_user_username_uq` ON `local_user` (`username`);--> statement-breakpoint
CREATE INDEX `local_user_active_idx` ON `local_user` (`active`,`username`);--> statement-breakpoint
CREATE TABLE `local_user_group` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`group_name` text NOT NULL,
	`granted_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `local_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_user_group_uq` ON `local_user_group` (`user_id`,`group_name`);--> statement-breakpoint
CREATE INDEX `local_user_group_name_idx` ON `local_user_group` (`group_name`,`user_id`);