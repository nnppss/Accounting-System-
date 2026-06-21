CREATE TABLE `year_close` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_id` integer NOT NULL,
	`next_year_id` integer NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`closed_by_user_id` integer,
	`summary_json` text NOT NULL,
	`rollback_json` text NOT NULL,
	`closed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`rolled_back_at` integer,
	FOREIGN KEY (`year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`next_year_id`) REFERENCES `financial_year`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `year_close_year_idx` ON `year_close` (`year_id`);