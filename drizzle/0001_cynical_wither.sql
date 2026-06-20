CREATE TABLE `aamad` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`no` text NOT NULL,
	`date` text NOT NULL,
	`kisan_account_id` integer NOT NULL,
	`total_packets` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kisan_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aamad_year_date_idx` ON `aamad` (`year_id`,`date`);--> statement-breakpoint
CREATE INDEX `aamad_kisan_idx` ON `aamad` (`kisan_account_id`);--> statement-breakpoint
CREATE TABLE `aamad_location` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`aamad_id` integer NOT NULL,
	`room` integer NOT NULL,
	`floor` integer NOT NULL,
	`rack` integer NOT NULL,
	`packets` integer NOT NULL,
	FOREIGN KEY (`aamad_id`) REFERENCES `aamad`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aamad_location_aamad_idx` ON `aamad_location` (`aamad_id`);--> statement-breakpoint
CREATE TABLE `nikasi` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`bill_no` integer NOT NULL,
	`date` text NOT NULL,
	`vehicle_no` text,
	`delivered_to_type` text NOT NULL,
	`delivered_to_account_id` integer NOT NULL,
	`received_by` text,
	`bhada_recovered_paise` integer DEFAULT 0 NOT NULL,
	`voucher_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivered_to_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nikasi_year_date_idx` ON `nikasi` (`year_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `nikasi_year_bill_idx` ON `nikasi` (`year_id`,`bill_no`);--> statement-breakpoint
CREATE TABLE `nikasi_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nikasi_id` integer NOT NULL,
	`from_kisan_account_id` integer NOT NULL,
	`room` integer NOT NULL,
	`floor` integer NOT NULL,
	`rack` integer NOT NULL,
	`packets` integer NOT NULL,
	`weight_kg` integer,
	`rate_paise` integer NOT NULL,
	FOREIGN KEY (`nikasi_id`) REFERENCES `nikasi`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_kisan_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nikasi_line_nikasi_idx` ON `nikasi_line` (`nikasi_id`);--> statement-breakpoint
CREATE TABLE `sauda` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`date` text NOT NULL,
	`vyapari_account_id` integer NOT NULL,
	`kisan_account_id` integer NOT NULL,
	`packets` integer NOT NULL,
	`rate_paise` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vyapari_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kisan_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sauda_year_idx` ON `sauda` (`year_id`,`date`);--> statement-breakpoint
CREATE TABLE `store_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rooms` integer DEFAULT 5 NOT NULL,
	`floors` integer DEFAULT 6 NOT NULL,
	`racks_per_floor` integer DEFAULT 160 NOT NULL
);
