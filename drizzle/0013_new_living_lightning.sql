ALTER TABLE `loading_contractor_year` ADD `loading_amount_paise` integer;--> statement-breakpoint
ALTER TABLE `loading_contractor_year` ADD `unloading_amount_paise` integer;--> statement-breakpoint
UPDATE `loading_contractor_year` SET `loading_amount_paise` = `yearly_amount_paise` WHERE `yearly_amount_paise` > 0;
