CREATE TABLE `mobile_sync_vaults` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`envelope_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "mobile_sync_revision_range" CHECK("mobile_sync_vaults"."revision" >= 1 AND "mobile_sync_vaults"."revision" <= 9007199254740991)
);
