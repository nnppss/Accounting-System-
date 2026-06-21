CREATE TABLE `account_series` (
	`type` text PRIMARY KEY NOT NULL,
	`current_no` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `account` ADD `code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `account_code_idx` ON `account` (`code`);