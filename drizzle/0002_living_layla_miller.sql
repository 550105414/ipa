CREATE TABLE `customer_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`customer_id` text,
	`customer_name` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customer_activity_owner_created` ON `customer_activity` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_customer_activity_owner_customer` ON `customer_activity` (`owner_id`,`customer_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `next_follow_up_at` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `purge_after` text;--> statement-breakpoint
CREATE INDEX `idx_customers_owner_follow_up` ON `customers` (`owner_id`,`next_follow_up_at`);--> statement-breakpoint
CREATE INDEX `idx_customers_owner_deleted` ON `customers` (`owner_id`,`deleted_at`);