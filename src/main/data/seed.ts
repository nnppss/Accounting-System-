import { db } from './db'
import { subgroup, type SubgroupNature } from './schema'

/**
 * The 9 fixed accounting subgroups every account rolls into (software.md §3.1).
 * Nature drives reporting classification; party groups (Farmer/debtors) are assets,
 * creditors/loans are liabilities. "Secured Loans" has no specific meaning yet
 * (kept for future use) — classified as a liability per Tally convention.
 */
export const SUBGROUP_SEED: ReadonlyArray<{ name: string; nature: SubgroupNature }> = [
  { name: 'Capital Account', nature: 'capital' },
  { name: 'Cash and Bank', nature: 'asset' },
  { name: 'Direct Expense', nature: 'expense' },
  { name: 'Farmer', nature: 'asset' },
  { name: 'Sundry Creditors', nature: 'liability' },
  { name: 'Sundry Debtors', nature: 'asset' },
  { name: 'Secured Loans', nature: 'liability' },
  { name: 'Revenue Account', nature: 'income' },
  { name: 'Income from Other Resource', nature: 'income' }
]

/** Idempotently insert the fixed reference data. Safe to call on every startup. */
export function seedReferenceData(): void {
  db().insert(subgroup).values([...SUBGROUP_SEED]).onConflictDoNothing().run()
}
