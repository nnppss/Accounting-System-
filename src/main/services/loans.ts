import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, loan, loanEvent, voucher, voucherEntry } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type {
  CapitaliseAllResult,
  CreateLoanResult,
  LoanDetail,
  LoanEventRow,
  LoanInput,
  LoanPaymentResult,
  LoanRow,
  StandingLoan
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { postCore } from './posting'
import { accruedForPayment, capitaliseLoan, ensureCapitalisedBefore, outstandingAsOf } from '../engines/interest'

/**
 * Loans (Udhaar) — software.md §3.8, posting map architecture.md §6. The cold lends to
 * kisan/vyapari/others; interest (1.5%/mo, simple year-1 then compound) lives in
 * `engines/interest.ts`. This service does the CRUD, the disbursement/repayment postings, and
 * the read models. A party may hold several loans, all visible in his ledger.
 *
 * Posting map:
 *   Loan given (direct)              Dr Party        Cr Cash/Bank      tag 'loan'
 *   Loan interest (1 Jan + payment)  Dr Party        Cr Interest Inc.  tag 'interest'
 *   Loan repaid by cash/cheque       Dr Cash/Bank    Cr Party          tag 'loan'
 *
 * An **indirect** loan (dues reclassified) moves no cash — its principal already sits in the
 * party's ledger — so creating one posts no disbursement; only its later interest posts.
 */
export type {
  CapitaliseAllResult,
  CreateLoanResult,
  LoanDetail,
  LoanEventRow,
  LoanInput,
  LoanPaymentResult,
  LoanRow,
  StandingLoan
} from '../../shared/contracts'

const DEFAULT_RATE_BPS = 150 // 1.5% per month

/** 1 Jan of the calendar year after `date` — when an indirect loan begins to accrue interest. */
function nextJan1(date: string): string {
  return `${Number(date.slice(0, 4)) + 1}-01-01`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createLoan(yearId: number, input: LoanInput, userId?: number): CreateLoanResult {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Loan amount must be a positive whole number of paise')
  }
  if (input.mode === 'bank' && !input.bankAccountId) {
    throw new Error('A bank loan needs a bank account')
  }
  const interestStartDate =
    input.interestStartDate ?? (input.nature === 'direct' ? input.date : nextJan1(input.date))
  const monthlyRateBps = input.monthlyRateBps ?? DEFAULT_RATE_BPS

  return db().transaction((tx) => {
    const row = tx
      .insert(loan)
      .values({
        yearId,
        category: input.category,
        accountId: input.accountId,
        date: input.date,
        principalPaise: input.amountPaise,
        mobile: input.mobile ?? null,
        mode: input.mode,
        bankAccountId: input.mode === 'bank' ? (input.bankAccountId ?? null) : null,
        nature: input.nature,
        monthlyRateBps,
        interestStartDate,
        remark: input.remark ?? null
      })
      .returning({ id: loan.id })
      .get()

    let voucherId: number | null = null
    if (input.nature === 'direct') {
      // Real cash/bank goes out: Dr Party / Cr Cash-or-Bank.
      const cashBank =
        input.mode === 'cash' ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH) : input.bankAccountId!
      const res = postCore(tx, {
        yearId,
        type: 'payment',
        date: input.date,
        narration: `Loan given — loan #${row.id}`,
        accountantUserId: userId,
        sourceModule: 'loan',
        sourceId: row.id,
        isAuto: true,
        entries: [
          { accountId: input.accountId, drPaise: input.amountPaise, crPaise: 0, tag: 'loan' },
          { accountId: cashBank, drPaise: 0, crPaise: input.amountPaise, tag: 'loan' }
        ]
      })
      voucherId = res.voucherId
    }

    tx.insert(loanEvent)
      .values({ loanId: row.id, date: input.date, type: 'disbursement', amountPaise: input.amountPaise, voucherId })
      .run()

    writeAudit(
      { userId, action: 'create', entity: 'loan', entityId: row.id, after: { ...input, interestStartDate } },
      tx
    )
    return { loanId: row.id, voucherId }
  })
}

/**
 * Record a (part-)payment against a loan on `date`. First posts any interest accrued on the
 * outstanding to that day (Dr Party / Cr Interest Income), then the cash received
 * (Dr Cash/Bank / Cr Party). The remainder keeps accruing. `mode` decides cash vs a bank book.
 */
export function recordPayment(
  loanId: number,
  amountPaise: number,
  date: string,
  mode: 'cash' | 'bank',
  bankAccountId: number | undefined,
  userId?: number
): LoanPaymentResult {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment must be a positive whole number of paise')
  }
  if (mode === 'bank' && !bankAccountId) throw new Error('A bank payment needs a bank account')

  // Fold any whole years that have passed, so this payment's interest is simple within its year.
  ensureCapitalisedBefore(loanId, date, userId)

  const ln = db().select().from(loan).where(eq(loan.id, loanId)).get()
  if (!ln) throw new Error(`Loan ${loanId} not found`)
  const { interestPaise, outstandingPaise } = accruedForPayment(loanId, date)
  if (amountPaise > outstandingPaise) {
    throw new Error(`Payment ${amountPaise} exceeds the outstanding ${outstandingPaise} paise`)
  }

  const cashBank = mode === 'cash' ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH) : bankAccountId!
  const interestIncome = getSystemAccountId(SYSTEM_ACCOUNTS.INTEREST_INCOME)

  const entries = [
    ...(interestPaise > 0
      ? [
          { accountId: ln.accountId, drPaise: interestPaise, crPaise: 0, tag: 'interest' as const },
          { accountId: interestIncome, drPaise: 0, crPaise: interestPaise, tag: 'interest' as const }
        ]
      : []),
    { accountId: cashBank, drPaise: amountPaise, crPaise: 0, tag: 'loan' as const },
    { accountId: ln.accountId, drPaise: 0, crPaise: amountPaise, tag: 'loan' as const }
  ]

  return db().transaction((tx) => {
    const res = postCore(tx, {
      yearId: ln.yearId,
      type: 'receipt',
      date,
      narration: `Loan repayment — loan #${loanId}`,
      accountantUserId: userId,
      sourceModule: 'loan',
      sourceId: loanId,
      isAuto: true,
      entries
    })
    tx.insert(loanEvent)
      .values({ loanId, date, type: 'payment', amountPaise, voucherId: res.voucherId })
      .run()
    writeAudit(
      { userId, action: 'create', entity: 'loan_payment', entityId: loanId, after: { amountPaise, date, interestPaise } },
      tx
    )
    return { voucherId: res.voucherId, interestPaise, principalPaise: amountPaise - interestPaise }
  })
}

/** Capitalise every loan in the year at `onDate` (a 1 Jan) — the Close-Year step (Phase 6). */
export function capitaliseAllLoans(yearId: number, onDate: string, userId?: number): CapitaliseAllResult {
  const loans = db().select({ id: loan.id }).from(loan).where(eq(loan.yearId, yearId)).all()
  let totalInterestPaise = 0
  let count = 0
  for (const l of loans) {
    const r = capitaliseLoan(l.id, onDate, userId)
    if (r) {
      totalInterestPaise += r.interestPaise
      count++
    }
  }
  return { loans: count, totalInterestPaise }
}

function rowFrom(
  l: typeof loan.$inferSelect,
  accountName: string,
  asOf: string
): LoanRow {
  return {
    id: l.id,
    category: l.category,
    accountId: l.accountId,
    accountName,
    date: l.date,
    principalPaise: l.principalPaise,
    mobile: l.mobile,
    mode: l.mode,
    bankAccountId: l.bankAccountId,
    nature: l.nature,
    monthlyRateBps: l.monthlyRateBps,
    interestStartDate: l.interestStartDate,
    remark: l.remark,
    outstandingPaise: outstandingAsOf(l.id, asOf).outstandingPaise
  }
}

export function listLoans(yearId: number, asOf?: string): LoanRow[] {
  const at = asOf ?? todayIso()
  const rows = db()
    .select({ loan, accountName: account.name })
    .from(loan)
    .innerJoin(account, eq(loan.accountId, account.id))
    .where(eq(loan.yearId, yearId))
    .orderBy(desc(loan.date), desc(loan.id))
    .all()
  return rows.map((r) => rowFrom(r.loan, r.accountName, at))
}

export function getLoan(loanId: number, asOf?: string): LoanDetail | null {
  const at = asOf ?? todayIso()
  const r = db()
    .select({ loan, accountName: account.name })
    .from(loan)
    .innerJoin(account, eq(loan.accountId, account.id))
    .where(eq(loan.id, loanId))
    .get()
  if (!r) return null
  const events: LoanEventRow[] = db()
    .select()
    .from(loanEvent)
    .where(eq(loanEvent.loanId, loanId))
    .orderBy(asc(loanEvent.date), asc(loanEvent.id))
    .all()
  return { ...rowFrom(r.loan, r.accountName, at), events, breakdown: outstandingAsOf(loanId, at) }
}

/**
 * Standing loan for a party from the ledger = loan- + interest-tagged net for the year
 * (mirrors getStandingBhada). For a fully-posted direct loan this equals the engine's live
 * figure at the last posted event date.
 */
export function getStandingLoan(accountId: number, yearId: number): StandingLoan {
  const acct = db().select().from(account).where(eq(account.id, accountId)).get()
  const row = db()
    .select({
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucherEntry.accountId, accountId),
        inTags(),
        eq(voucher.yearId, yearId),
        isNull(voucher.voidedAt)
      )
    )
    .get()
  return {
    accountId,
    accountName: acct?.name ?? `#${accountId}`,
    standingPaise: row?.net ?? 0
  }
}

/** SQL helper: entry tag is 'loan' or 'interest'. */
function inTags() {
  return sql`${voucherEntry.tag} in ('loan', 'interest')`
}
