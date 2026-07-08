ALTER TABLE `nikasi_line` ADD `aamad_id` integer REFERENCES aamad(id);--> statement-breakpoint
CREATE INDEX `nikasi_line_aamad_idx` ON `nikasi_line` (`aamad_id`);