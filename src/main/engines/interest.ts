import Decimal from 'decimal.js'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { loan, loanEvent, voucher } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type {
  CapitaliseResult,
  InterestFixResult,
  LoanOutstanding,
  PartyInterestFixResult
} from '../../shared/contracts'
import { post, voidVoucher } from '../services/posting'
import { writeAudit } from '../audit/audit'

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
 * Replay the loan's **posted** history (recorded payments + capitalisations) up to and including
 * `cutoff`, returning the capitalised base and the date of the last fold. This is the base the NEXT
 * posted interest accrues from. Synthetic year-boundaries are NOT auto-folded here — callers post
 * them explicitly so the ledger always mirrors the engine.
 *
 * A posted capitalisation folds in the amount that was **posted**, not a fresh calculation of it:
 * for an automatic fold the two are the same number, but the accountant may have fixed the figure
 * by hand (`fixLoanInterest`), and that is the one the books carry.
 *
 * Same-day events count: a second payment on a day that already saw one must see the balance the
 * first one left, or it would settle against a stale, too-high outstanding — and a fold on the day
 * of a payment must not re-charge the interest that payment already posted. Nothing is
 * double-charged by including them — accruing from a date to itself is zero — and it keeps this in
 * step with `outstandingAsOf`, which has always counted payments on `asOf` itself.
 */
function replayPosted(ln: LoanRecord, events: EventRecord[], cutoff: string): FoldState {
  const caps = events.filter((e) => isFold(e.type))
  let base = ln.principalPaise
  let baseDate = ln.interestStartDate
  for (const ev of events) {
    if (ev.type === 'disbursement') continue
    if (isFold(ev.type)) {
      base += ev.amountPaise
      baseDate = ev.date
      continue
    }
    if (ev.date > cutoff) continue
    if (!isDeclared(caps, baseDate, ev.date)) {
      base += accrue(base, baseDate, ev.date, ln.monthlyRateBps)
      baseDate = ev.date
    }
    base -= ev.amountPaise
  }
  return { basePaise: base, baseDate }
}

/** Interest folded into the base and posted: the automatic year-end, or a figure fixed by hand. */
function isFold(type: EventRecord['type']): boolean {
  return type === 'capitalisation' || type === 'interest_fix'
}

/**
 * Is `at` inside a stretch whose interest is already settled? A posted fold carries the interest for
 * everything from the last fold up to its own date, so once one is posted at `2026-12-31` nothing
 * accrues in between — not at a payment made in September, not at the 1 Jan of a year it spans. The
 * figure for the whole stretch is the one on the books.
 */
function isDeclared(caps: EventRecord[], windowStart: string, at: string): boolean {
  return caps.some((c) => c.date >= at && c.date > windowStart)
}

type Fold = { date: string; kind: 'boundary' | 'payment' | 'posted'; amount: number }

/**
 * Pure live outstanding as of `asOf` — principal + accrued interest − repayments, auto-folding
 * every 1 Jan in between (so interest compounds across years). Posts nothing.
 *
 * Interest already posted is taken at its posted amount, and only the 1-Jans still missing are
 * computed here. For automatic folds that changes nothing — same number either way — but it is
 * what makes a hand-fixed figure hold: no recomputation can reproduce a number the accountant
 * chose, so the engine must not try.
 *
 * A fold posted for a date still ahead of `asOf` counts too, and settles everything up to it: once
 * the accountant fixes the interest to 31 Dec, that is what the party owes in October — the meter is
 * off until then, and turns again from 31 Dec.
 */
export function outstandingAsOf(loanId: number, asOf: string): LoanOutstanding {
  const ln = loadLoan(loanId)
  const events = loadEvents(loanId).filter((e) => e.type !== 'disbursement')
  const caps = events.filter((e) => isFold(e.type))

  // Merge the posted events with synthetic folds for the 1-Jans that are still missing, in date
  // order (interest folds in before a payment on the same day).
  const folds: Fold[] = [
    ...januaryBoundaries(ln.interestStartDate, asOf, true)
      .filter((d) => !caps.some((c) => c.date === d))
      .map((d) => ({ date: d, kind: 'boundary' as const, amount: 0 })),
    ...events
      .filter((e) => isFold(e.type) || e.date <= asOf)
      .map((e) => ({
        date: e.date,
        kind: e.type === 'payment' ? ('payment' as const) : ('posted' as const),
        amount: e.amountPaise
      }))
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'payment' ? 1 : -1) : a.date < b.date ? -1 : 1))

  let base = ln.principalPaise
  let baseDate = ln.interestStartDate
  for (const f of folds) {
    // Posted interest replaces the stretch's accrual; the rest earn it at the loan's rate.
    if (f.kind === 'posted') {
      base += f.amount
      baseDate = f.date
      continue
    }
    if (!isDeclared(caps, baseDate, f.date)) {
      base += accrue(base, baseDate, f.date, ln.monthlyRateBps)
      baseDate = f.date
    }
    if (f.kind === 'payment') base -= f.amount
  }
  // Zero once a fold has settled past `asOf` — `accrue` returns 0 for a backwards span.
  const accruedInterestPaise = accrue(base, baseDate, asOf, ln.monthlyRateBps)
  return {
    loanId,
    principalPaise: base,
    accruedInterestPaise,
    outstandingPaise: base + accruedInterestPaise,
    asOf
  }
}

/** Whether the automatic year-end fold has already been posted at `onDate` for this loan. */
function capitalisationAt(events: EventRecord[], onDate: string): EventRecord | undefined {
  return events.find((e) => e.type === 'capitalisation' && e.date === onDate)
}

/**
 * Post the prior-period interest up to `atDate` (Dr Party / Cr Interest Income) and record the fold.
 * The amount is accrued on the posted base unless `fixedPaise` is given, in which case that figure
 * is the interest for the period — see `fixLoanInterest`. A fixed ₹0 still records the fold (with no
 * voucher, there being nothing to post): the zero is the accountant's answer and it must stick.
 *
 * `sharedVoucherId` hands the fold a voucher posted by someone else instead of posting its own —
 * how `fixPartyInterest` puts one interest row on a person's ledger while each of his loans still
 * keeps its own exact fold. Pass `null` for "the caller posted nothing" (a person-wide ₹0).
 */
function postCapitalisationAt(
  ln: LoanRecord,
  atDate: string,
  userId?: number,
  fixedPaise?: number,
  sharedVoucherId?: number | null
): number {
  const { basePaise, baseDate } = replayPosted(ln, loadEvents(ln.id), atDate)
  const interest = fixedPaise ?? accrue(basePaise, baseDate, atDate, ln.monthlyRateBps)
  if (interest <= 0 && fixedPaise == null) return 0
  const interestIncome = getSystemAccountId(SYSTEM_ACCOUNTS.INTEREST_INCOME)
  const voucherId =
    sharedVoucherId !== undefined
      ? sharedVoucherId
      : interest > 0
        ? post({
            yearId: ln.yearId,
            type: 'journal',
            date: atDate,
            narration:
              fixedPaise == null
                ? `Loan interest capitalised — loan #${ln.id}`
                : `Loan interest fixed by accountant — loan #${ln.id}`,
            accountantUserId: userId,
            sourceModule: 'loan',
            sourceId: ln.id,
            isAuto: true,
            entries: [
              { accountId: ln.accountId, drPaise: interest, crPaise: 0, tag: 'interest' },
              { accountId: interestIncome, drPaise: 0, crPaise: interest, tag: 'interest' }
            ]
          }).voucherId
        : null
  db()
    .insert(loanEvent)
    .values({
      loanId: ln.id,
      date: atDate,
      type: fixedPaise == null ? 'capitalisation' : 'interest_fix',
      amountPaise: interest,
      voucherId
    })
    .run()
  return interest
}

/**
 * Void a fold's voucher, unless another loan sharing it got there first. A person-level interest
 * fix posts ONE voucher for all his loans, so several folds can point at the same voucher and a
 * plain `voidVoucher` would throw "already voided" on the second one.
 */
function voidFoldVoucher(voucherId: number | null, reason: string, userId?: number): void {
  if (!voucherId) return
  const v = db()
    .select({ voidedAt: voucher.voidedAt })
    .from(voucher)
    .where(eq(voucher.id, voucherId))
    .get()
  if (!v || v.voidedAt) return
  voidVoucher(voucherId, reason, userId)
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
  const interest = recapitaliseAt(loanId, onDate, userId, 'loan interest re-capitalised')
  if (interest <= 0) return null
  const ev = db()
    .select()
    .from(loanEvent)
    .where(and(eq(loanEvent.loanId, loanId), eq(loanEvent.type, 'capitalisation'), eq(loanEvent.date, onDate)))
    .get()
  return { loanId, voucherId: ev!.voucherId!, interestPaise: interest }
}

/**
 * Set the interest on a loan to `interestPaise` up to and including `atDate`, replacing whatever the
 * engine worked out. The cold settles interest by agreement — round ₹1,529 down to ₹1,500, or add
 * for a delay — and once agreed it is a fact, not a calculation: this posts it as the fold at
 * `atDate`, so everything up to that date is settled at exactly that figure and never recomputed.
 *
 * `atDate` is normally ahead: "your interest is ₹10,800 up to 31 December" means the meter is off
 * until then, whatever the rate would have said. Interest runs again from `atDate`, on the new base
 * and at the loan's usual rate.
 *
 * Re-editable, and an edit replaces rather than adds: one fixed figure per loan per year, so fixing
 * ₹10,800 in July and again in December leaves ₹10,800, not ₹21,600. The automatic year-ends are
 * never touched — they are history, and each year's fix stands on its own.
 * ponytail: a year is the unit because that is how the cold settles ("interest for 2026"), and folds
 * land on 1 Jan anyway. Two separate fixed stretches within one year would need a real window model.
 */
export function fixLoanInterest(
  loanId: number,
  atDate: string,
  interestPaise: number,
  userId?: number
): InterestFixResult {
  if (!Number.isInteger(interestPaise) || interestPaise < 0) {
    throw new Error('Interest must be zero or a positive whole number of paise')
  }
  const ln = loadLoan(loanId)
  if (atDate < ln.interestStartDate) {
    throw new Error(`Interest on loan #${loanId} only starts on ${ln.interestStartDate}`)
  }
  const before = fixedInterestIn(loadEvents(loanId), atDate.slice(0, 4))
  dropFixesIn(loanId, atDate.slice(0, 4), userId)
  recapitaliseAt(loanId, atDate, userId, 'loan interest re-fixed', interestPaise)
  writeAudit({
    userId,
    action: 'update',
    entity: 'loan_interest',
    entityId: loanId,
    before: { interestPaise: before, atDate },
    after: { interestPaise, atDate }
  })
  return { loanId, atDate, interestPaise }
}

/**
 * Split `total` across `weights` in proportion, in whole paise, so the parts sum to exactly
 * `total` — the odd paise go to the biggest remainders (largest-remainder method), never lost or
 * invented. Returns all-zero when the weights carry no signal; the caller decides the fallback.
 */
function splitProRata(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => new Decimal(total).times(w).div(sum))
  const out = exact.map((e) => e.floor().toNumber())
  const order = exact
    .map((e, i) => ({ i, rem: e.minus(out[i]) }))
    .sort((a, b) => b.rem.comparedTo(a.rem))
  let left = total - out.reduce((s, v) => s + v, 0)
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length].i] += 1
  return out
}

/**
 * Fix the interest on **everything one party owes**, as one figure — the way the cold actually
 * settles it ("Nitesh's interest is ₹10,800 to 31 Dec"), rather than loan by loan.
 *
 * A person's loans can run at different rates from different dates, so there is no single accrual
 * to compute: the engine works each loan out on its own terms and the figures are summed. The
 * accountant types the total he has agreed; it is split back across the loans **pro-rata to what
 * each one actually accrued**, so every loan keeps an exact fold the engine can carry forward and
 * the parts still add up to the agreed number to the paise. Where nothing has accrued anywhere yet
 * (a fresh loan, a 0% rate), the split falls back to what each loan is carrying.
 *
 * One voucher is posted for the whole amount and every loan's fold hangs off it, so the party's
 * ledger shows a single interest row instead of one per loan.
 *
 * ponytail: not wrapped in one transaction — `post`/`voidVoucher` each open their own, and
 * threading a tx through the engine is a bigger change than this earns. Same exposure as
 * `fixLoanInterest` today, and the operation is idempotent: re-running it drops the year's fixes
 * and re-posts, so a half-finished run is corrected by just doing it again.
 */
export function fixPartyInterest(
  accountId: number,
  yearId: number,
  atDate: string,
  totalInterestPaise: number,
  userId?: number
): PartyInterestFixResult {
  if (!Number.isInteger(totalInterestPaise) || totalInterestPaise < 0) {
    throw new Error('Interest must be zero or a positive whole number of paise')
  }
  const loans = db()
    .select()
    .from(loan)
    .where(and(eq(loan.accountId, accountId), eq(loan.yearId, yearId)))
    .orderBy(asc(loan.id))
    .all()
    .filter((l) => atDate >= l.interestStartDate)
  if (loans.length === 0) {
    throw new Error(`No loan of this party has interest running on ${atDate}`)
  }

  // Clear the year's fixes first: a re-fix replaces the earlier figure rather than adding to it,
  // and it puts the loans back on their own accrual so the weights below are the engine's own.
  for (const l of loans) dropFixesIn(l.id, atDate.slice(0, 4), userId)
  for (const l of loans) ensureCapitalisedBefore(l.id, atDate, userId)

  const accrued = loans.map((l) => accruedForPayment(l.id, atDate).interestPaise)
  let shares = splitProRata(totalInterestPaise, accrued)
  if (shares.every((s) => s === 0) && totalInterestPaise > 0) {
    // Nothing has accrued anywhere (all 0% or every loan starts today), so there is no interest to
    // be proportional to — fall back to what each loan is carrying.
    shares = splitProRata(
      totalInterestPaise,
      loans.map((l) => outstandingAsOf(l.id, atDate).outstandingPaise)
    )
  }

  const ln = loans[0]
  const voucherId =
    totalInterestPaise > 0
      ? post({
          yearId: ln.yearId,
          type: 'journal',
          date: atDate,
          narration: `Loan interest fixed by accountant — ${loans.length} loan(s)`,
          accountantUserId: userId,
          sourceModule: 'loan',
          sourceId: ln.id,
          isAuto: true,
          entries: [
            { accountId, drPaise: totalInterestPaise, crPaise: 0, tag: 'interest' },
            {
              accountId: getSystemAccountId(SYSTEM_ACCOUNTS.INTEREST_INCOME),
              drPaise: 0,
              crPaise: totalInterestPaise,
              tag: 'interest'
            }
          ]
        }).voucherId
      : null

  loans.forEach((l, i) =>
    recapitaliseAt(l.id, atDate, userId, 'loan interest re-fixed', shares[i], voucherId)
  )
  writeAudit({
    userId,
    action: 'update',
    entity: 'loan_interest',
    entityId: accountId,
    after: { atDate, totalInterestPaise, shares: loans.map((l, i) => [l.id, shares[i]]) }
  })
  return {
    accountId,
    atDate,
    totalInterestPaise,
    voucherId,
    shares: loans.map((l, i) => ({ loanId: l.id, interestPaise: shares[i] }))
  }
}

/** What the accountant has already fixed the interest at, for the calendar `year`. */
export function fixedInterestIn(events: EventRecord[], year: string): number {
  return events
    .filter((e) => e.type === 'interest_fix' && e.date.startsWith(year))
    .reduce((s, e) => s + e.amountPaise, 0)
}

/** Undo the fixes already made for `year` — an edit replaces the earlier figure, never adds to it. */
function dropFixesIn(loanId: number, year: string, userId?: number): void {
  for (const ev of loadEvents(loanId)) {
    if (ev.type !== 'interest_fix' || !ev.date.startsWith(year)) continue
    voidFoldVoucher(ev.voucherId, 'loan interest re-fixed', userId)
    db().delete(loanEvent).where(eq(loanEvent.id, ev.id)).run()
  }
}

/**
 * Fold the interest at `onDate`, posting any missing prior 1-Jans first and replacing an existing
 * fold at that date (voiding its voucher) so the operation can be repeated or corrected. Returns
 * the interest folded in. With `fixedPaise`, that figure is used instead of the accrual;
 * `sharedVoucherId` attaches the fold to a voucher the caller already posted.
 */
function recapitaliseAt(
  loanId: number,
  onDate: string,
  userId: number | undefined,
  voidReason: string,
  fixedPaise?: number,
  sharedVoucherId?: number | null
): number {
  ensureCapitalisedBefore(loanId, onDate, userId)
  const existing = capitalisationAt(loadEvents(loanId), onDate)
  if (existing) {
    voidFoldVoucher(existing.voucherId, voidReason, userId)
    db().delete(loanEvent).where(eq(loanEvent.id, existing.id)).run()
  }
  return postCapitalisationAt(loadLoan(loanId), onDate, userId, fixedPaise, sharedVoucherId)
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
