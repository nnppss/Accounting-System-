import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { account, storeConfig, subgroup, type SubgroupNature } from './schema'

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
  { name: 'Indirect Expense', nature: 'expense' },
  { name: 'Farmer', nature: 'asset' },
  { name: 'Sundry Creditors', nature: 'liability' },
  { name: 'Sundry Debtors', nature: 'asset' },
  { name: 'Secured Loans', nature: 'liability' },
  { name: 'Duties & Taxes', nature: 'liability' },
  { name: 'Fixed Assets', nature: 'asset' },
  { name: 'Current Assets', nature: 'asset' },
  { name: 'Loans & Advances (Asset)', nature: 'asset' },
  { name: 'Revenue Account', nature: 'income' },
  { name: 'Income from Other Resource', nature: 'income' },
  { name: 'Indirect Income', nature: 'income' }
  // ponytail: add Investments/Provisions here (one line each) if the books ever need them.
]

/**
 * The cold's own books (system accounts). Stable English names double as lookup keys
 * (`getSystemAccountId`) — services post against these rather than user-named parties.
 * Banks are NOT here: the user creates one account per real bank (subgroup Cash and Bank).
 */
export const SYSTEM_ACCOUNTS = {
  CASH: 'Cash',
  CAPITAL: 'Capital',
  RENT_INCOME: 'Rent/Bhada Income',
  INTEREST_INCOME: 'Interest Income',
  BARDANA_SALES: 'Bardana Sales',
  BARDANA_PURCHASE: 'Bardana Purchase',
  SALARY_EXPENSE: 'Salary Expense',
  LOADING_EXPENSE: 'Loading Expense',
  OPENING_EQUITY: 'Opening Balance Equity',
  // A clearing/suspense account that holds a cheque between entry and clearance. It is
  // deliberately NOT in the 'Cash and Bank' subgroup, so the Money Book (which filters by that
  // subgroup) shows cleared money only. It nets to zero once every cheque has cleared/bounced.
  CHEQUES_IN_CLEARING: 'Cheques in Clearing'
} as const

export type SystemAccountName = (typeof SYSTEM_ACCOUNTS)[keyof typeof SYSTEM_ACCOUNTS]

const SYSTEM_ACCOUNT_SEED: ReadonlyArray<{ name: SystemAccountName; subgroup: string }> = [
  { name: SYSTEM_ACCOUNTS.CASH, subgroup: 'Cash and Bank' },
  { name: SYSTEM_ACCOUNTS.CAPITAL, subgroup: 'Capital Account' },
  { name: SYSTEM_ACCOUNTS.RENT_INCOME, subgroup: 'Revenue Account' },
  { name: SYSTEM_ACCOUNTS.INTEREST_INCOME, subgroup: 'Income from Other Resource' },
  { name: SYSTEM_ACCOUNTS.BARDANA_SALES, subgroup: 'Income from Other Resource' },
  { name: SYSTEM_ACCOUNTS.BARDANA_PURCHASE, subgroup: 'Direct Expense' },
  { name: SYSTEM_ACCOUNTS.SALARY_EXPENSE, subgroup: 'Direct Expense' },
  { name: SYSTEM_ACCOUNTS.LOADING_EXPENSE, subgroup: 'Direct Expense' },
  { name: SYSTEM_ACCOUNTS.OPENING_EQUITY, subgroup: 'Capital Account' },
  { name: SYSTEM_ACCOUNTS.CHEQUES_IN_CLEARING, subgroup: 'Sundry Debtors' }
]

/** Idempotently insert the fixed reference data (subgroups + the cold's own books + store layout). */
export function seedReferenceData(): void {
  db().insert(subgroup).values([...SUBGROUP_SEED]).onConflictDoNothing().run()

  // Single-row store layout (current 5×6×160) — created once, edited later via Store config.
  if (!db().select({ id: storeConfig.id }).from(storeConfig).get()) {
    db().insert(storeConfig).values({ rooms: 5, floors: 6, racksPerFloor: 160 }).run()
  }

  const groups = db().select({ id: subgroup.id, name: subgroup.name }).from(subgroup).all()
  const groupId = new Map(groups.map((g) => [g.name, g.id]))

  for (const sa of SYSTEM_ACCOUNT_SEED) {
    const exists = db()
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.name, sa.name), eq(account.isSystem, true)))
      .get()
    if (exists) continue
    const subId = groupId.get(sa.subgroup)
    if (subId === undefined) throw new Error(`Seed error: subgroup '${sa.subgroup}' missing`)
    db()
      .insert(account)
      .values({ name: sa.name, type: 'other', subgroupId: subId, isSystem: true })
      .run()
  }
}

/** Resolve a system account's id by its stable name. Throws if the seed hasn't run. */
export function getSystemAccountId(name: SystemAccountName): number {
  const row = db()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.name, name), eq(account.isSystem, true)))
    .get()
  if (!row) throw new Error(`System account '${name}' not found — was seedReferenceData() called?`)
  return row.id
}
