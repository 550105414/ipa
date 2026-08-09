DELETE FROM `customer_activity`
WHERE `customer_id` = '7f0243e4-2ac3-4aec-a29e-36bf4c746491';--> statement-breakpoint
DELETE FROM `customers`
WHERE `id` = '7f0243e4-2ac3-4aec-a29e-36bf4c746491'
  AND `name` = '机器功能测试'
  AND `phone` = '19908092215';
