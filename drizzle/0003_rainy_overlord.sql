ALTER TABLE `customers` ADD `shop_name` text;--> statement-breakpoint
CREATE INDEX `idx_customers_owner_shop_name` ON `customers` (`owner_id`,`shop_name`);