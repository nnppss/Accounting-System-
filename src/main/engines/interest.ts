import Decimal from 'decimal.js'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { loan, loanEvent } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type { CapitaliseResult, LoanOutstanding } from '../../shared/contracts'
import { post, voidVoucher } from '../services/posting'

/**
 * Interest engine — architecture.md §7 / software.md §3.8.
 *
 * Rule: **1.5%/month, simple within a year, compound thereafter; capitalised every 1 Jan.**
 * A loan carries a capitalised `principal` base and an `interestStartDate`. Interest accrues at
 * the monthly rate on that base; within a calendar year it stays simple, and on each 1 Jan the
 * year's accrued interest is folded into the base (so from then on it earns interest too).
 *
 *   ₹1,00,000 on 1 Jan 2026 → 1 Jan 2027 = ₹1,18,000 (12 × 1.5% = ₹18,000, simple)
 *                           → 1 Jan 2028 = ₹1,39,240 (₹1,18,000 × 18% = ₹21,240, compound)
 *
 * Two faces:
 *   • `outstandingAsOf` — a pure live figure (auto-folds every 1 Jan, applies recorded payments).
 *     Posts nothing; used by Bills/Party. The total is invariant to whether folds are posted yet.
 *   • `capitaliseLoan` / (loan payments, in `services/loans.ts`) — DO post: Dr Party / Cr Interest
 *     Income on capitalisation and on payment, keeping the ledger equal to the engine figure.
 *
 * All money is integer paise; the math runs on decimal.js and each accrual rounds to paise.
 */
export type { LoanOutstanding } from '../../shared/contracts'

export type FoldState = { basePaise: number; baseDate: string }

const HALF_UP = Decimal.ROUND_HALF_UP

function parseYmd(d: string): [number, number, number] {
  const [y, m, dd] = d.split('-').map(Number)
  return [y, m, dd]
}

/** Calendar days in month `m` (1-12) of `y` — used for the day-fraction of a month. */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/**
 * Months between two ISO dates as a decimal: whole calendar months plus a day fraction
 * (remaining days ÷ days in the target month). Two consecutive 1-Jans are exactly 12 months
 * apart, which makes the worked examples paise-exact. Negative if `to` precedes `from`.
 */
export function monthsBetween(from: string, to: string): Decimal {
  const [fy, fm, fd] = parseYmd(from)
  const [ty, tm, td] = parseYmd(to)
  const whole = (ty - fy) * 12 + (tm - fm)
  const frac = new Decimal(td - fd).div(daysInMonth(ty, tm))
  return new Decimal(whole).plus(frac)
}

/** Simple interest in paise on `basePaise` from `from` to `to` at `monthlyRateBps`. 0 if non-positive span. */
export function accrue(basePaise: number, from: string, to: string, monthlyRateBps: number): number {
  const months = monthsBetween(from, to)
  if (months.lte(0)) return 0
  return new Decimal(basePaise)
    .times(monthlyRateBps)
    .div(10000)
    .times(months)
    .toDecimalPlaces(0, HALF_UP)
    .toNumber()
}

/** Every 1 Jan strictly after `start`, up to `limit` (inclusive or exclusive). */
function januaryBoundaries(start: string, limit: string, inclusive: boolean): string[] {
  const startYear = Number(start.slice(0, 4))
  const out: string[] = []
  for (let y = startYear + 1; ; y++) {
    const d = `${y}-01-01`
    if (inclusive ? d > limit : d >= limit) break
    out.push(d)
  }
  return out
}

type LoanRecord = typeof loan.$inferSelect
type EventRecord = typeof loanEvent.$inferSelect

function loadLoan(loanId: number): LoanRecord {
  const row = db().select().from(loan).where(eq(loan.id, loanId)).get()
  if (!row) throw new Error(`Loan ${loanId} not found`)
  return row
}

function loadEvents(loanId: number): EventRecord[] {
  return db()
    .select()
    .from(loanEvent)
    .where(eq(loanEvent.loanId, loanId))
    .orderBy(asc(loanEvent.date), asc(loanEvent.id))
    .all()
}

/**
 * Replay the loan's **posted** history (recorded payments + capitalisations) up to `cutoff`
 * (exclusive), returning the capitalised base and the date of the last fold. This is the base
 * the NEXT posted interest accrues from. Synthetic year-boundaries are NOT auto-folded here —
 * callers post them explicitly so the ledger always mirrors the engine.
 */
function replayPosted(ln: LoanRecord, events: EventRecord[], cutoff: string): FoldState {
  let base = ln.principalPaise
  let baseDate = ln.interestStartDate
  for (const ev of events) {
    if (ev.type === 'disbursement') continue
    if (ev.date >= cutoff) break
    const accrued = accrue(base, baseDate, ev.date, ln.monthlyRateBps)
    base = ev.type === 'payment' ? base + accrued - ev.amountPaise : base + accrued
    baseDate = ev.date
  }
  return { basePaise: base, baseDate }
}

/**
 * Pure live outstanding as of `asOf` — principal + accrued interest − repayments, auto-folding
 * every 1 Jan in between (so interest compounds across years). Posts nothing.
 */
export function outstandingAsOf(loanId: number, asOf: string): LoanOutstanding {
  const ln = loadLoan(loanId)
  const payments = loadEvents(loanId).filter((e) => e.type === 'payment')

  // Merge recorded payments with synthetic 1-Jan folds, in date order (fold before payment on a tie).
  const folds: Array<{ date: string; kind: 'boundary' | 'payment'; amount: number }> = [
    ...januaryBoundaries(ln.interestStartDate, asOf, true).map((d) => ({
      date: d,
      kind: 'boundary' as const,
      amount: 0
    })),
    ...payments
      .filter((p) => p.date <= asOf)
      .map((p) => ({ date: p.date, kind: 'payment' as const, amount: p.amountPaise }))
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'boundary' ? -1 : 1) : a.date < b.date ? -1 : 1))

  let base = ln.principalPaise
  let baseDate = ln.interestStartDate
  for (const f of folds) {
    const accrued = accrue(base, baseDate, f.date, ln.monthlyRateBps)
    base = f.kind === 'payment' ? base + accrued - f.amount : base + accrued
    baseDate = f.date
  }
  const accruedInterestPaise = accrue(base, baseDate, asOf, ln.monthlyRateBps)
  return {
    loanId,
    principalPaise: base,
    accruedInterestPaise,
    outstandingPaise: base + accruedInterestPaise,
    asOf
  }
}

/** Whether a capitalisation has already been posted at `onDate` for this loan. */
function capitalisationAt(events: EventRecord[], onDate: string): EventRecord | undefined {
  return events.find((e) => e.type === 'capitalisation' && e.date === onDate)
}

/** Post the prior-period interest accrued on the posted base up to `atDate` (Dr Party / Cr Interest Income). */
function postCapitalisationAt(ln: LoanRecord, atDate: string, userId?: number): number {
  const { basePaise, baseDate } = replayPosted(ln, loadEvents(ln.id), atDate)
  const interest = accrue(basePaise, baseDate, atDate, ln.monthlyRateBps)
  if (interest <= 0) return 0
  const interestIncome = getSystemAccountId(SYSTEM_ACCOUNTS.INTEREST_INCOME)
  const res = post({
    yearId: ln.yearId,
    type: 'journal',
    date: atDate,
    narration: `Loan interest capitalised — loan #${ln.id}`,
    accountantUserId: userId,
    sourceModule: 'loan',
    sourceId: ln.id,
    isAuto: true,
    entries: [
      { accountId: ln.accountId, drPaise: interest, crPaise: 0, tag: 'interest' },
      { accountId: interestIncome, drPaise: 0, crPaise: interest, tag: 'interest' }
    ]
  })
  db()
    .insert(loanEvent)
    .values({ loanId: ln.id, date: atDate, type: 'capitalisation', amountPaise: interest, voucherId: res.voucherId })
    .run()
  return interest
}

/**
 * Ensure every 1 Jan strictly before `date` has been capitalised (posting any that are missing,
 * in order). Used before a payment/capitalisation so accrual on the current base stays simple
 * within its year and compounds across year boundaries.
 */
export function ensureCapitalisedBefore(loanId: number, date: string, userId?: number): void {
  const ln = loadLoan(loanId)
  for (const b of januaryBoundaries(ln.interestStartDate, date, false)) {
    if (!capitalisationAt(loadEvents(loanId), b)) postCapitalisationAt(ln, b, userId)
  }
}

/**
 * Capitalise interest up to and including `onDate` (a 1 Jan). Posts any missing prior boundaries
 * first, then the fold at `onDate`. Idempotent: re-running for an already-capitalised `onDate`
 * voids the prior voucher + event and re-posts. Returns null when the interest is zero.
 */
export function capitaliseLoan(loanId: number, onDate: string, userId?: number): CapitaliseResult | null {
  ensureCapitalisedBefore(loanId, onDate, userId)
  const existing = capitalisationAt(loadEvents(loanId), onDate)
  if (existing) {
    if (existing.voucherId) voidVoucher(existing.voucherId, 'loan interest re-capitalised', userId)
    db().delete(loanEvent).where(eq(loanEvent.id, existing.id)).run()
  }
  const ln = loadLoan(loanId)
  const interest = postCapitalisationAt(ln, onDate, userId)
  if (interest <= 0) return null
  const ev = db()
    .select()
    .from(loanEvent)
    .where(and(eq(loanEvent.loanId, loanId), eq(loanEvent.type, 'capitalisation'), eq(loanEvent.date, onDate)))
    .get()
  return { loanId, voucherId: ev!.voucherId!, interestPaise: interest }
}

/** The posted base + interest accrued to `date` (used by loan payments to know what to settle). */
export function accruedForPayment(
  loanId: number,
  date: string
): { basePaise: number; baseDate: string; interestPaise: number; outstandingPaise: number } {
  const ln = loadLoan(loanId)
  const state = replayPosted(ln, loadEvents(loanId), date)
  const interest = accrue(state.basePaise, state.baseDate, date, ln.monthlyRateBps)
  return {
    basePaise: state.basePaise,
    baseDate: state.baseDate,
    interestPaise: interest,
    outstandingPaise: state.basePaise + interest
  }
}
