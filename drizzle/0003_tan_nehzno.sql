CREATE TABLE `bardana` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`direction` text NOT NULL,
	`date` text NOT NULL,
	`party_account_id` integer,
	`rate_paise` integer NOT NULL,
	`qty` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`mode` text NOT NULL,
	`bank_account_id` integer,
	`voucher_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bardana_year_dir_idx` ON `bardana` (`year_id`,`direction`);