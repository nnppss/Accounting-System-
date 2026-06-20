import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Phase 0 placeholder table (smoke test). The full schema (person, account,
// subgroup, financial_year, voucher, voucher_entry, cheque, audit_log, …)
// is introduced in Phase 1.
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
