CREATE TABLE `loan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`category` text NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`principal_paise` integer NOT NULL,
	`mobile` text,
	`mode` text NOT NULL,
	`bank_account_id` integer,
	`nature` text NOT NULL,
	`monthly_rate_bps` integer DEFAULT 150 NOT NULL,
	`interest_start_date` text NOT NULL,
	`remark` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loan_year_account_idx` ON `loan` (`year_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `loan_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`voucher_id` integer,
	FOREIGN KEY (`loan_id`) REFERENCES `loan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loan_event_loan_idx` ON `loan_event` (`loan_id`);