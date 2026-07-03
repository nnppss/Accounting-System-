ALTER TABLE `loading_contractor_year` ADD `yearly_amount_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `loading_contractor_year` SET `yearly_amount_paise` = `loading_charge_paise` + `unloading_charge_paise`;
