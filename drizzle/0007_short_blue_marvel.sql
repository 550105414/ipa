CREATE TABLE `device_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`device_name` text,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_device_pairings_owner_created` ON `device_pairings` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_device_pairings_expires` ON `device_pairings` (`expires_at`);--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`pairing_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`pairing_id`) REFERENCES `device_pairings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_tokens_pairing_unique` ON `device_tokens` (`pairing_id`);--> statement-breakpoint
CREATE INDEX `idx_device_tokens_owner_revoked` ON `device_tokens` (`owner_id`,`revoked_at`);