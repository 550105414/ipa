CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`category` text DEFAULT '直营' NOT NULL,
	`id_card_front_key` text,
	`id_card_back_key` text,
	`bank_card_ciphertext` text,
	`bank_card_last4` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_owner_created` ON `customers` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_customers_owner_status` ON `customers` (`owner_id`,`id_card_front_key`,`id_card_back_key`);--> statement-breakpoint
CREATE INDEX `idx_customers_owner_category` ON `customers` (`owner_id`,`category`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`customer_id` text,
	`title` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_owner_status_due` ON `tasks` (`owner_id`,`status`,`due_at`);