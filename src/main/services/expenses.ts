import { aliasedTable, and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, loadingContractorYear, voucher, voucherEntry } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type {
  ExpensePaymentInput,
  ExpenseRow,
  LoadingContractorYearInput,
  LoadingContractorYearRow,
  PayExpenseResult
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { assertMoneyAccount } from './accounts'
import { post } from './posting'

/**
 * Side-ledger expenses — software.md §2 (Staff salaries) and §3.7 (Loading contractors). Each
 * payment routes through the paid party's own ledger so the transaction is documented there
 * (charge + payment, net 0), mirroring the bardana posting:
 *
 *   Salary   sourceModule 'salary'   Dr Salary Expense / Cr Staff  +  Dr Staff / Cr Cash-Bank
 *   Loading  sourceModule 'loading'  Dr Loading Expense / Cr Contractor  +  Dr Contractor / Cr Cash-Bank
 *
 * The party also stays on the voucher's `sourceId` so the per-party register/Bill can attribute
 * the payment without parsing entries.
 */
export type {
  ExpensePaymentInput,
  ExpenseRow,
  LoadingContractorYearInput,
  LoadingContractorYearRow,
  PayExpenseResult
} from '../../shared/contracts'

function payExpense(
  yearId: number,
  sourceModule: 'salary' | 'loading',
  expenseAccount: number,
  input: ExpensePaymentInput,
  defaultNarration: string,
  userId?: number
): PayExpenseResult {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Payment must be a positive whole number of paise')
  }
  if (input.mode === 'bank') {
    if (!input.bankAccountId) throw new Error('A bank payment needs a bank account')
    assertMoneyAccount(input.bankAccountId)
  }
  const cashBank =
    input.mode === 'cash' ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH) : input.bankAccountId!
  const party = db()
    .select({ name: account.name })
    .from(account)
    .where(eq(account.id, input.partyAccountId))
    .get()
  if (!party) throw new Error(`Party account ${input.partyAccountId} not found`)

  const res = post({
    yearId,
    type: 'payment',
    date: input.date,
    narration: input.narration ?? `${defaultNarration} — ${party.name}`,
    accountantUserId: userId,
    sourceModule,
    sourceId: input.partyAccountId,
    isAuto: true,
    // The charge lands on the party's ledger, then the payment settles it — net 0, fully documented.
    entries: [
      { accountId: expenseAccount, drPaise: input.amountPaise, crPaise: 0, tag: 'general' },
      { accountId: input.partyAccountId, drPaise: 0, crPaise: input.amountPaise, tag: 'general' },
      { accountId: input.partyAccountId, drPaise: input.amountPaise, crPaise: 0, tag: 'general' },
      { accountId: cashBank, drPaise: 0, crPaise: input.amountPaise, tag: 'general' }
    ]
  })
  return { voucherId: res.voucherId }
}

/** Pay a staff salary: Dr Salary Expense / Cr Cash-Bank. */
export function paySalary(yearId: number, input: ExpensePaymentInput, userId?: number): PayExpenseResult {
  return payExpense(
    yearId,
    'salary',
    getSystemAccountId(SYSTEM_ACCOUNTS.SALARY_EXPENSE),
    input,
    'Staff salary',
    userId
  )
}

/** Pay a loading contractor: Dr Loading Expense / Cr Cash-Bank. */
export function payLoadingContractor(
  yearId: number,
  input: ExpensePaymentInput,
  userId?: number
): PayExpenseResult {
  return payExpense(
    yearId,
    'loading',
    getSystemAccountId(SYSTEM_ACCOUNTS.LOADING_EXPENSE),
    input,
    'Loading contractor charges',
    userId
  )
}

/** The register behind a salary/loading expense head — each payment, attributed to its party. */
function listRegister(yearId: number, sourceModule: 'salary' | 'loading'): ExpenseRow[] {
  const party = aliasedTable(account, 'party')
  // Sum only the expense-head debit: the voucher also carries party legs (charge + payment).
  const expenseHead = getSystemAccountId(
    sourceModule === 'salary' ? SYSTEM_ACCOUNTS.SALARY_EXPENSE : SYSTEM_ACCOUNTS.LOADING_EXPENSE
  )
  const rows = db()
    .select({
      voucherId: voucher.id,
      voucherNo: voucher.no,
      date: voucher.date,
      narration: voucher.narration,
      partyAccountId: voucher.sourceId,
      partyName: party.name,
      amountPaise: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0)`
    })
    .from(voucher)
    .innerJoin(
      voucherEntry,
      and(eq(voucherEntry.voucherId, voucher.id), eq(voucherEntry.accountId, expenseHead))
    )
    .leftJoin(party, eq(voucher.sourceId, party.id))
    .where(
      and(eq(voucher.yearId, yearId), eq(voucher.sourceModule, sourceModule), isNull(voucher.voidedAt))
    )
    .groupBy(voucher.id)
    .orderBy(desc(voucher.date), desc(voucher.no))
    .all()
  return rows.map((r) => ({
    voucherId: r.voucherId,
    voucherNo: r.voucherNo,
    date: r.date,
    partyAccountId: r.partyAccountId,
    partyName: r.partyName,
    amountPaise: r.amountPaise,
    narration: r.narration
  }))
}

export function listSalaryRegister(yearId: number): ExpenseRow[] {
  return listRegister(yearId, 'salary')
}

export function listLoadingRegister(yearId: number): ExpenseRow[] {
  return listRegister(yearId, 'loading')
}

/** The quoted yearly loading/unloading amounts for a contractor (null = not decided yet). */
export function getLoadingContractorYear(
  accountId: number,
  yearId: number
): LoadingContractorYearRow {
  const acct = db().select({ name: account.name }).from(account).where(eq(account.id, accountId)).get()
  const row = db()
    .select()
    .from(loadingContractorYear)
    .where(and(eq(loadingContractorYear.accountId, accountId), eq(loadingContractorYear.yearId, yearId)))
    .get()
  return {
    accountId,
    accountName: acct?.name ?? `#${accountId}`,
    loadingAmountPaise: row?.loadingAmountPaise ?? null,
    unloadingAmountPaise: row?.unloadingAmountPaise ?? null
  }
}

/** Upsert a loading contractor's quoted yearly amounts — either side may stay undecided (null). */
export function setLoadingContractorYear(
  yearId: number,
  input: LoadingContractorYearInput,
  userId?: number
): void {
  for (const v of [input.loadingAmountPaise, input.unloadingAmountPaise]) {
    if (v !== null && (!Number.isInteger(v) || v < 0)) {
      throw new Error('Amounts must be non-negative whole paise')
    }
  }
  db()
    .insert(loadingContractorYear)
    .values({
      accountId: input.accountId,
      yearId,
      loadingAmountPaise: input.loadingAmountPaise,
      unloadingAmountPaise: input.unloadingAmountPaise
    })
    .onConflictDoUpdate({
      target: [loadingContractorYear.accountId, loadingContractorYear.yearId],
      set: {
        loadingAmountPaise: input.loadingAmountPaise,
        unloadingAmountPaise: input.unloadingAmountPaise
      }
    })
    .run()
  writeAudit({ userId, action: 'update', entity: 'loading_contractor_year', entityId: input.accountId, after: input })
}

/** All loading-contractor accounts with their quoted yearly amounts (one row each). */
export function listLoadingContractorYears(yearId: number): LoadingContractorYearRow[] {
  const contractors = db()
    .select({ id: account.id })
    .from(account)
    .where(eq(account.type, 'loading_contractor'))
    .all()
  return contractors.map((c) => getLoadingContractorYear(c.id, yearId))
}
