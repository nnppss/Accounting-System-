import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, cheque, financialYear, loan, loanEvent, person, voucher, voucherEntry, yearClose } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type {
  CreateLoanResult,
  LoanComposition,
  LoanDetail,
  LoanEventRow,
  LoanInput,
  LoanPaymentResult,
  LoanRow,
  StandingLoan
} from '../../shared/contracts'
import type { EntryTag } from '../../shared/enums'
import { writeAudit } from '../audit/audit'
import { assertMoneyAccount } from './accounts'
import { postCore } from './posting'
import { accruedForPayment, ensureCapitalisedBefore, outstandingAsOf } from '../engines/interest'

/**
 * Loans (Udhaar) — software.md §3.8, posting map architecture.md §6. The cold lends to
 * kisan/vyapari/others; interest (1.5%/mo, simple year-1 then compound) lives in
 * `engines/interest.ts`. This service does the CRUD, the disbursement/repayment postings, and
 * the read models. A party may hold several loans, all visible in his ledger.
 *
 * Posting map:
 *   Loan given (direct)              Dr Party        Cr Cash/Bank      tag 'loan'
 *   Loan given by cheque             Dr Party        Cr Clearing       tag 'loan'  (+ cheque row;
 *                                    clearing→bank on clearance, interest from clearance date)
 *   Loan interest (1 Jan + payment)  Dr Party        Cr Interest Inc.  tag 'interest'
 *   Loan repaid by cash/bank         Dr Cash/Bank    Cr Party          tag 'loan'
 *   Loan repaid by cheque            Dr Clearing     Cr Party          tag 'loan'  (+ cheque row)
 *
 * An **indirect** loan (dues reclassified) moves no cash — its principal already sits in the
 * party's ledger — so creating one posts no disbursement; only its later interest posts.
 */
export type {
  CreateLoanResult,
  LoanComposition,
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
  if (input.mode !== 'cash') {
    if (!input.bankAccountId) throw new Error('A bank/cheque loan needs a bank account')
    assertMoneyAccount(input.bankAccountId)
  }
  if (input.mode === 'cheque') {
    if (input.nature !== 'direct') throw new Error('A cheque loan must be direct — indirect loans move no money')
    if (!input.chequeNo?.trim()) throw new Error('A cheque loan needs a cheque number')
  }
  // A cheque loan earns interest from the clearance date: provisionally the expected date (or the
  // loan date), corrected to the actual date when the cheque clears (engines/cheque-clearing.ts).
  const interestStartDate =
    input.interestStartDate ??
    (input.mode === 'cheque'
      ? (input.chequeClearanceDate ?? input.date)
      : input.nature === 'direct'
        ? input.date
        : nextJan1(input.date))
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
        bankAccountId: input.mode !== 'cash' ? (input.bankAccountId ?? null) : null,
        nature: input.nature,
        monthlyRateBps,
        interestStartDate,
        remark: input.remark ?? null
      })
      .returning({ id: loan.id })
      .get()

    let voucherId: number | null = null
    let chequeId: number | null = null
    if (input.nature === 'direct') {
      // Money goes out: Dr Party / Cr Cash-or-Bank — or Cr Clearing for a cheque, which only
      // hits the bank when it clears (cheque-clearing engine).
      const creditAccount =
        input.mode === 'cash'
          ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
          : input.mode === 'bank'
            ? input.bankAccountId!
            : getSystemAccountId(SYSTEM_ACCOUNTS.CHEQUES_IN_CLEARING)
      const res = postCore(tx, {
        yearId,
        type: 'payment',
        date: input.date,
        narration:
          input.mode === 'cheque'
            ? `Loan given by cheque ${input.chequeNo} — loan #${row.id} (in clearing)`
            : `Loan given — loan #${row.id}`,
        accountantUserId: userId,
        sourceModule: 'loan',
        sourceId: row.id,
        isAuto: true,
        entries: [
          { accountId: input.accountId, drPaise: input.amountPaise, crPaise: 0, tag: 'loan' },
          { accountId: creditAccount, drPaise: 0, crPaise: input.amountPaise, tag: 'loan' }
        ]
      })
      voucherId = res.voucherId

      if (input.mode === 'cheque') {
        chequeId = tx
          .insert(cheque)
          .values({
            voucherId,
            no: input.chequeNo!,
            bank: input.chequeBank ?? null,
            direction: 'given',
            amountPaise: input.amountPaise,
            date: input.date,
            clearanceDate: input.chequeClearanceDate ?? null,
            status: 'pending',
            bankAccountId: input.bankAccountId!,
            partyAccountId: input.accountId
          })
          .returning({ id: cheque.id })
          .get().id
      }
    }

    tx.insert(loanEvent)
      .values({ loanId: row.id, date: input.date, type: 'disbursement', amountPaise: input.amountPaise, voucherId })
      .run()

    writeAudit(
      { userId, action: 'create', entity: 'loan', entityId: row.id, after: { ...input, interestStartDate } },
      tx
    )
    return { loanId: row.id, voucherId, chequeId }
  })
}

/**
 * Record a (part-)payment against a loan on `date`. First posts any interest accrued on the
 * outstanding to that day (Dr Party / Cr Interest Income), then the money received
 * (Dr Cash/Bank / Cr Party). The remainder keeps accruing. `mode` decides cash vs a bank book;
 * a cheque payment debits Clearing instead and registers a pending 'received' cheque, which
 * hits the bank only on clearance.
 */
export function recordPayment(
  loanId: number,
  amountPaise: number,
  date: string,
  mode: 'cash' | 'bank' | 'cheque',
  bankAccountId: number | undefined,
  userId?: number,
  chequeDetails?: { no: string; bank?: string }
): LoanPaymentResult {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment must be a positive whole number of paise')
  }
  if (mode !== 'cash') {
    if (!bankAccountId) throw new Error('A bank/cheque payment needs a bank account')
    assertMoneyAccount(bankAccountId)
  }
  if (mode === 'cheque' && !chequeDetails?.no?.trim()) throw new Error('A cheque payment needs a cheque number')

  // Fold any whole years that have passed, so this payment's interest is simple within its year.
  ensureCapitalisedBefore(loanId, date, userId)

  const ln = db().select().from(loan).where(eq(loan.id, loanId)).get()
  if (!ln) throw new Error(`Loan ${loanId} not found`)
  const { interestPaise, outstandingPaise } = accruedForPayment(loanId, date)
  if (amountPaise > outstandingPaise) {
    throw new Error(`Payment ${amountPaise} exceeds the outstanding ${outstandingPaise} paise`)
  }

  const cashBank =
    mode === 'cash'
      ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
      : mode === 'bank'
        ? bankAccountId!
        : getSystemAccountId(SYSTEM_ACCOUNTS.CHEQUES_IN_CLEARING)
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
      narration:
        mode === 'cheque'
          ? `Loan repayment by cheque ${chequeDetails!.no} — loan #${loanId} (in clearing)`
          : `Loan repayment — loan #${loanId}`,
      accountantUserId: userId,
      sourceModule: 'loan',
      sourceId: loanId,
      isAuto: true,
      entries
    })
    if (mode === 'cheque') {
      tx.insert(cheque)
        .values({
          voucherId: res.voucherId,
          no: chequeDetails!.no,
          bank: chequeDetails!.bank ?? null,
          direction: 'received',
          amountPaise,
          date,
          status: 'pending',
          bankAccountId: bankAccountId!,
          partyAccountId: ln.accountId
        })
        .run()
    }
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

function rowFrom(
  l: typeof loan.$inferSelect,
  accountName: string,
  sonOf: string | null,
  asOf: string
): LoanRow {
  return {
    id: l.id,
    category: l.category,
    accountId: l.accountId,
    accountName,
    sonOf,
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
    .select({ loan, accountName: account.name, sonOf: person.sonOf })
    .from(loan)
    .innerJoin(account, eq(loan.accountId, account.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(eq(loan.yearId, yearId))
    .orderBy(desc(loan.date), desc(loan.id))
    .all()
  return rows.map((r) => rowFrom(r.loan, r.accountName, r.sonOf, at))
}

export function getLoan(loanId: number, asOf?: string): LoanDetail | null {
  const at = asOf ?? todayIso()
  const r = db()
    .select({ loan, accountName: account.name, sonOf: person.sonOf })
    .from(loan)
    .innerJoin(account, eq(loan.accountId, account.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(eq(loan.id, loanId))
    .get()
  if (!r) return null
  const events: LoanEventRow[] = db()
    .select()
    .from(loanEvent)
    .where(eq(loanEvent.loanId, loanId))
    .orderBy(asc(loanEvent.date), asc(loanEvent.id))
    .all()
  return { ...rowFrom(r.loan, r.accountName, r.sonOf, at), events, breakdown: outstandingAsOf(loanId, at) }
}

/**
 * What a carried-forward indirect loan is made of. The year-end close records every indirect loan
 * it creates in its `year_close.rollback_json` (`indirectLoanIds`); the loan's principal is exactly
 * that party's closing balance for the **closed** year. We reconstruct the make-up by netting the
 * closed year's ledger for the party, grouped by tag — no snapshot stored, so it can never drift
 * from the books. Returns null for manual indirect loans (no year-end origin) and for direct loans.
 */
export function getLoanComposition(loanId: number): LoanComposition | null {
  const ln = db().select().from(loan).where(eq(loan.id, loanId)).get()
  if (!ln || ln.nature !== 'indirect') return null

  // Find the close that created this loan, and the year it closed.
  const closes = db()
    .select({ yearId: yearClose.yearId, rollbackJson: yearClose.rollbackJson })
    .from(yearClose)
    .where(eq(yearClose.status, 'closed'))
    .all()
  let sourceYearId: number | null = null
  for (const c of closes) {
    const ids = (JSON.parse(c.rollbackJson) as { indirectLoanIds?: number[] }).indirectLoanIds ?? []
    if (ids.includes(loanId)) {
      sourceYearId = c.yearId
      break
    }
  }
  if (sourceYearId == null) return null

  const yr = db().select({ year: financialYear.year }).from(financialYear).where(eq(financialYear.id, sourceYearId)).get()

  // Net the party's closed-year ledger, grouped by tag — the slices sum to the loan principal.
  const rows = db()
    .select({
      tag: voucherEntry.tag,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucherEntry.accountId, ln.accountId),
        eq(voucher.yearId, sourceYearId),
        isNull(voucher.voidedAt)
      )
    )
    .groupBy(voucherEntry.tag)
    .all()

  const lines = rows
    .filter((r) => r.net !== 0)
    .map((r) => ({ tag: r.tag as EntryTag, paise: r.net }))
  return {
    loanId,
    sourceYear: yr?.year ?? 0,
    lines,
    totalPaise: lines.reduce((s, l) => s + l.paise, 0)
  }
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
