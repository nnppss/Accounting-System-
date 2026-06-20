CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subgroup_id` integer NOT NULL,
	`person_id` integer,
	`is_defaulter` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`job` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`subgroup_id`) REFERENCES `subgroup`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_subgroup_idx` ON `account` (`subgroup_id`);--> statement-breakpoint
CREATE INDEX `account_type_idx` ON `account` (`type`);--> statement-breakpoint
CREATE INDEX `account_person_idx` ON `account` (`person_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer,
	`before_json` text,
	`after_json` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `cheque` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_id` integer,
	`no` text NOT NULL,
	`bank` text,
	`direction` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`date` text,
	`issue_date` text,
	`clearance_date` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`bank_account_id` integer,
	`party_account_id` integer,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cheque_status_idx` ON `cheque` (`status`);--> statement-breakpoint
CREATE TABLE `financial_year` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`rent_rate_paise` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_year_year_unique` ON `financial_year` (`year`);--> statement-breakpoint
CREATE TABLE `loading_contractor_year` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`year_id` integer NOT NULL,
	`loading_charge_paise` integer DEFAULT 0 NOT NULL,
	`unloading_charge_paise` integer DEFAULT 0 NOT NULL,
	`labourers_loading` integer DEFAULT 0 NOT NULL,
	`labourers_unloading` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loading_contractor_year_idx` ON `loading_contractor_year` (`account_id`,`year_id`);--> statement-breakpoint
CREATE TABLE `number_series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`doc_type` text NOT NULL,
	`current_no` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `number_series_idx` ON `number_series` (`year_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `opening_balance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`year_id` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`dr_cr` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opening_balance_acct_year_idx` ON `opening_balance` (`account_id`,`year_id`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`son_of` text,
	`village_city` text,
	`state` text,
	`phone` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subgroup` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`nature` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subgroup_name_unique` ON `subgroup` (`name`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`accountant_name` text NOT NULL,
	`role` text DEFAULT 'accountant' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `voucher` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`no` integer NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`narration` text,
	`accountant_user_id` integer,
	`source_module` text,
	`source_id` integer,
	`is_auto` integer DEFAULT false NOT NULL,
	`voided_at` integer,
	`voided_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accountant_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voucher_year_date_idx` ON `voucher` (`year_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `voucher_year_type_no_idx` ON `voucher` (`year_id`,`type`,`no`);--> statement-breakpoint
CREATE TABLE `voucher_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`dr_paise` integer DEFAULT 0 NOT NULL,
	`cr_paise` integer DEFAULT 0 NOT NULL,
	`tag` text DEFAULT 'general' NOT NULL,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_voucher_idx` ON `voucher_entry` (`voucher_id`);--> statement-breakpoint
CREATE INDEX `entry_account_idx` ON `voucher_entry` (`account_id`);