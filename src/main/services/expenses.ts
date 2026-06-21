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
import { post } from './posting'

/**
 * Side-ledger expenses — software.md §2 (Staff salaries) and §3.7 (Loading contractors). Both are
 * simple payment vouchers (posting map architecture.md §6: "Salary / Loading | Expense |
 * Cash/Bank"): Dr the expense head, Cr Cash/Bank. The paid party (a staff or loading-contractor
 * account) is captured on the voucher's `sourceId` + narration so a per-party register/Bill can
 * attribute it later — the money itself hits the expense head, not the party's ledger.
 *
 *   Salary   sourceModule 'salary'   Dr Salary Expense  / Cr Cash-Bank
 *   Loading  sourceModule 'loading'  Dr Loading Expense / Cr Cash-Bank
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
  if (input.mode === 'bank' && !input.bankAccountId) throw new Error('A bank payment needs a bank account')
  const cashBank =
    input.mode === 'cash' ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH) : input.bankAccountId!

  const res = post({
    yearId,
    type: 'payment',
    date: input.date,
    narration: input.narration ?? defaultNarration,
    accountantUserId: userId,
    sourceModule,
    sourceId: input.partyAccountId,
    isAuto: true,
    entries: [
      { accountId: expenseAccount, drPaise: input.amountPaise, crPaise: 0, tag: 'general' },
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
    .innerJoin(voucherEntry, eq(voucherEntry.voucherId, voucher.id))
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

/** The per-year charges/labourer counts for a loading contractor (creates a default row if absent). */
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
    loadingChargePaise: row?.loadingChargePaise ?? 0,
    unloadingChargePaise: row?.unloadingChargePaise ?? 0,
    labourersLoading: row?.labourersLoading ?? 0,
    labourersUnloading: row?.labourersUnloading ?? 0
  }
}

/** Upsert a loading contractor's per-year charges/labourer counts. */
export function setLoadingContractorYear(
  yearId: number,
  input: LoadingContractorYearInput,
  userId?: number
): void {
  for (const v of [input.loadingChargePaise, input.unloadingChargePaise]) {
    if (!Number.isInteger(v) || v < 0) throw new Error('Charges must be non-negative whole paise')
  }
  for (const v of [input.labourersLoading, input.labourersUnloading]) {
    if (!Number.isInteger(v) || v < 0) throw new Error('Labourer counts must be non-negative integers')
  }
  db()
    .insert(loadingContractorYear)
    .values({
      accountId: input.accountId,
      yearId,
      loadingChargePaise: input.loadingChargePaise,
      unloadingChargePaise: input.unloadingChargePaise,
      labourersLoading: input.labourersLoading,
      labourersUnloading: input.labourersUnloading
    })
    .onConflictDoUpdate({
      target: [loadingContractorYear.accountId, loadingContractorYear.yearId],
      set: {
        loadingChargePaise: input.loadingChargePaise,
        unloadingChargePaise: input.unloadingChargePaise,
        labourersLoading: input.labourersLoading,
        labourersUnloading: input.labourersUnloading
      }
    })
    .run()
  writeAudit({ userId, action: 'update', entity: 'loading_contractor_year', entityId: input.accountId, after: input })
}

/** All loading-contractor accounts with their per-year charges (one row each, defaulting to zero). */
export function listLoadingContractorYears(yearId: number): LoadingContractorYearRow[] {
  const contractors = db()
    .select({ id: account.id })
    .from(account)
    .where(eq(account.type, 'loading_contractor'))
    .all()
  return contractors.map((c) => getLoadingContractorYear(c.id, yearId))
}
