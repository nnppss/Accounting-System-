import { and, asc, desc, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../data/db'
import { SYSTEM_ACCOUNTS } from '../data/seed'
import {
  account,
  financialYear,
  loan,
  loanEvent,
  openingBalance,
  subgroup,
  voucher,
  voucherEntry,
  yearClose
} from '../data/schema'
import type { AccountType, LoanCategory, SubgroupNature } from '../../shared/enums'
import type {
  CloseException,
  ClosePreview,
  CloseResult,
  CloseSummary,
  YearCloseInfo
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { createYear } from '../auth/auth'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { setDefaulter, setOpeningBalance } from '../services/accounts'
import { createLoan } from '../services/loans'
import { capitaliseLoan, accruedForPayment } from './interest'
import { listCheques } from '../services/cheques'
import { getMap } from '../services/maps'
import { voidVoucher } from '../services/posting'

/**
 * Close-Year engine — software.md §3.13, architecture.md §7. Closes one accounting year in a
 * single button, in order:
 *   1. **Capitalise interest** — fold every loan's interest at the 1-Jan boundary (so the closing
 *      balances are final before they roll forward). Reuses the idempotent `capitaliseLoan`.
 *   2. **Carry-forward** — each party's closing balance becomes next year's opening (reuses
 *      `setOpeningBalance`, which posts the balancing `opening` voucher).
 *   3. **Indirect loans** — each owing party's carried dues become an interest-free indirect loan
 *      that starts accruing on 1 Jan of the new year (posts nothing; the principal already rolled
 *      forward in the opening balance).
 *   4. **Flag defaulters** — every party that still owes at year-end.
 *   5. **Reset maps** — implicit (maps are year-scoped reads; the new year has no stock). The
 *      leftover packet count is recorded for the report ("leftover packets disposed").
 *
 * Capitalisation must run **before** carry-forward: it posts the year's final interest into the
 * closing year, so the balance that rolls forward (and the indirect-loan principal) is complete.
 * This is the documented order with that one correctness refinement.
 *
 * **Atomicity & reversibility.** The steps reuse services that each manage their own SQLite
 * transaction, so the close can't sit inside one outer transaction. Instead it records a
 * **rollback plan** as it goes (`RollbackPlan`); on any mid-way error it replays the plan and
 * rethrows (all-or-nothing), and the same plan powers the user-facing **undo close** the spec
 * requires. The `year_close` row persists the plan + the summary.
 */
export type { CloseException, ClosePreview, CloseResult, CloseSummary, YearCloseInfo } from '../../shared/contracts'

/** The compensating actions an undo replays — every artifact the close created. */
interface RollbackPlan {
  /** Capitalisation vouchers to void + their loan_event rows to delete. */
  capVoucherIds: number[]
  capEventIds: number[]
  /** Carry-forward opening vouchers to void. */
  openingVoucherIds: number[]
  /** opening_balance rows the close newly created (pre-existing ones are left alone). */
  openingBalanceIds: number[]
  /** Indirect loans (+ their events) the close created. */
  indirectLoanIds: number[]
  /** Accounts the close newly flagged defaulter (already-flagged ones aren't here). */
  defaulterAccountIds: number[]
  /** True if the close created the next financial year (left in place — voided vouchers FK it). */
  createdNextYear: boolean
}

const emptyPlan = (): RollbackPlan => ({
  capVoucherIds: [],
  capEventIds: [],
  openingVoucherIds: [],
  openingBalanceIds: [],
  indirectLoanIds: [],
  defaulterAccountIds: [],
  createdNextYear: false
})

function nextJan1(year: number): string {
  return `${year + 1}-01-01`
}

/** A party account's role mapped to a loan category (kisan / vyapari / other). */
function loanCategoryOf(type: AccountType): LoanCategory {
  return type === 'kisan' ? 'kisan' : type === 'vyapari' ? 'vyapari' : 'other'
}

interface PartyAccount {
  id: number
  name: string
  type: AccountType
  nature: SubgroupNature
  subgroupName: string
  isSystem: boolean
}

/**
 * Balance-sheet accounts carried across the year boundary: everything of asset, liability or
 * capital nature — cash, banks, cheques-in-clearing, every debtor/creditor party, and the owners'
 * capital accounts (their proprietary firms are the same legal person, so their injections/draws
 * are equity that must roll forward like any permanent account). Only income and expense — the
 * nominal accounts that close to zero each year — are NOT carried.
 *
 * **Opening Balance Equity** is the one capital account we exclude: it is a per-year plug that
 * `setOpeningBalance` rebuilds from each year's fresh openings (and which it refuses to target), so
 * carrying it would double-count the contra of every opening entry.
 *
 * We deliberately do NOT filter on `isSystem` here: **Cash** and **Capital** are system accounts but
 * their balances are real and must roll forward, while the **bank** accounts a user creates are
 * non-system yet must never be mistaken for owing parties (that distinction is `isTradeParty`).
 * Keying off the crude `isSystem` flag was the original bug — it dropped Cash and swept banks into
 * dues/defaulters.
 */
function carriedAccounts(): PartyAccount[] {
  return db()
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      nature: subgroup.nature,
      subgroupName: subgroup.name,
      isSystem: account.isSystem
    })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .where(
      and(
        inArray(subgroup.nature, ['asset', 'liability', 'capital']),
        ne(account.name, SYSTEM_ACCOUNTS.OPENING_EQUITY)
      )
    )
    .orderBy(asc(account.id))
    .all()
}

/**
 * A carried account that is a genuine **trade party** — a real debtor/creditor whose closing dues
 * may roll into an indirect loan and a defaulter flag. Only the party subgroups qualify: the
 * cold's own funds (Cash and Bank), fixed assets, secured loans, etc. carry their balance but are
 * never "owing" — a building with a Dr balance must not become a defaulter with an indirect loan.
 */
const TRADE_PARTY_SUBGROUPS = new Set(['Farmer', 'Sundry Debtors', 'Sundry Creditors'])
function isTradeParty(a: { isSystem: boolean; subgroupName: string }): boolean {
  return !a.isSystem && TRADE_PARTY_SUBGROUPS.has(a.subgroupName)
}

/**
 * Interest each loan in the year would capitalise at `onDate` (the 1-Jan boundary), summed per
 * party account — used by the dry-run preview to project the post-capitalisation closing balance
 * without posting. (After the real capitalisation, `getAccountBalance` already includes it.)
 */
function projectedInterestByAccount(yearId: number, onDate: string): Map<number, number> {
  const loans = db()
    .select({ id: loan.id, accountId: loan.accountId })
    .from(loan)
    .where(eq(loan.yearId, yearId))
    .all()
  const byAccount = new Map<number, number>()
  for (const l of loans) {
    const interest = accruedForPayment(l.id, onDate).interestPaise
    if (interest > 0) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + interest)
  }
  return byAccount
}

/** The exceptions list (software.md §3.13): pending cheques, credit balances, leftover stock, odd state. */
function buildExceptions(
  yearId: number,
  closings: Array<{ accountId: number; name: string; balancePaise: number }>,
  leftoverPackets: number
): CloseException[] {
  const exceptions: CloseException[] = []

  for (const c of listCheques(yearId, 'pending')) {
    exceptions.push({
      kind: 'pending_cheque',
      accountId: c.partyAccountId,
      accountName: c.partyName,
      amountPaise: c.amountPaise,
      chequeNo: c.no,
      chequeDirection: c.direction
    })
  }

  for (const c of closings) {
    if (c.balancePaise < 0) {
      exceptions.push({
        kind: 'credit_balance',
        accountId: c.accountId,
        accountName: c.name,
        amountPaise: -c.balancePaise
      })
    }
  }

  if (leftoverPackets > 0) {
    exceptions.push({
      kind: 'leftover_stock',
      amountPaise: undefined,
      packets: leftoverPackets
    })
  }

  if (!getTrialBalance(yearId).balanced) {
    exceptions.push({ kind: 'unbalanced' })
  }

  return exceptions
}

/** The active (not rolled-back) close record for a year, with both years' numbers. */
export function getCloseStatus(yearId: number): YearCloseInfo | null {
  const row = db()
    .select()
    .from(yearClose)
    .where(and(eq(yearClose.yearId, yearId), eq(yearClose.status, 'closed')))
    .orderBy(asc(yearClose.id))
    .all()
    .at(-1)
  if (!row) return null
  const yr = db().select().from(financialYear).where(eq(financialYear.id, row.yearId)).get()
  const nyr = db().select().from(financialYear).where(eq(financialYear.id, row.nextYearId)).get()
  return {
    id: row.id,
    yearId: row.yearId,
    year: yr?.year ?? 0,
    nextYearId: row.nextYearId,
    nextYear: nyr?.year ?? 0,
    status: row.status,
    closedAt: row.closedAt instanceof Date ? Math.floor(row.closedAt.getTime() / 1000) : Number(row.closedAt),
    closedByUserId: row.closedByUserId,
    summary: JSON.parse(row.summaryJson) as CloseSummary
  }
}

/**
 * Dry-run: what the close WOULD produce, computed without posting. Projects the post-capitalisation
 * closing balances (so dues/credits/defaulters match the real close) and lists the exceptions.
 */
export function previewClose(yearId: number): ClosePreview {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)
  const onDate = nextJan1(yr.year)
  const interestByAccount = projectedInterestByAccount(yearId, onDate)

  const closings = carriedAccounts()
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      type: a.type,
      isSystem: a.isSystem,
      subgroupName: a.subgroupName,
      balancePaise: getAccountBalance(a.id, yearId) + (interestByAccount.get(a.id) ?? 0)
    }))
    .filter((c) => c.balancePaise !== 0)

  const parties = closings.filter(isTradeParty)
  const owing = parties.filter((c) => c.balancePaise > 0)
  const alreadyDefaulter = new Set(
    db().select({ id: account.id }).from(account).where(eq(account.isDefaulter, true)).all().map((r) => r.id)
  )

  let interestCapitalisedPaise = 0
  let loansCapitalised = 0
  for (const v of interestByAccount.values()) interestCapitalisedPaise += v
  // count loans (not accounts) that would capitalise
  const loans = db().select({ id: loan.id }).from(loan).where(eq(loan.yearId, yearId)).all()
  for (const l of loans) if (accruedForPayment(l.id, onDate).interestPaise > 0) loansCapitalised++

  const leftoverPackets = getMap(yearId, 'current').totalPackets

  const summary: CloseSummary = {
    yearId,
    year: yr.year,
    nextYear: yr.year + 1,
    accountsCarried: closings.length,
    totalDuesPaise: owing.reduce((s, c) => s + c.balancePaise, 0),
    totalCreditsPaise: parties.filter((c) => c.balancePaise < 0).reduce((s, c) => s - c.balancePaise, 0),
    newDefaulters: owing.filter((c) => !alreadyDefaulter.has(c.accountId)).length,
    indirectLoans: owing.length,
    indirectLoanTotalPaise: owing.reduce((s, c) => s + c.balancePaise, 0),
    loansCapitalised,
    interestCapitalisedPaise,
    leftoverPackets
  }

  return {
    summary,
    exceptions: buildExceptions(yearId, parties, leftoverPackets),
    alreadyClosed: getCloseStatus(yearId) !== null
  }
}

/**
 * Close the year. Password-gating happens at the IPC layer (the accountant re-enters their
 * password); this engine assumes the caller is authorised. Throws if the year is already closed
 * (roll back first to re-close). On any mid-way failure it rolls back what it did and rethrows.
 */
export function closeYear(yearId: number, userId?: number): CloseResult {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)
  if (getCloseStatus(yearId)) throw new Error(`Year ${yr.year} is already closed — roll back the close to re-run it`)

  // Years close oldest-first: closing over an open earlier year would carry stale balances forward.
  const earlierOpen = db()
    .select({ year: financialYear.year })
    .from(financialYear)
    .where(and(lt(financialYear.year, yr.year), eq(financialYear.status, 'open')))
    .orderBy(asc(financialYear.year))
    .get()
  if (earlierOpen) throw new Error(`Close ${earlierOpen.year} first — years must be closed oldest to newest`)

  const onDate = nextJan1(yr.year)
  const plan = emptyPlan()

  try {
    // Resolve (or create) the next year to receive carry-forwards.
    let next = db().select().from(financialYear).where(eq(financialYear.year, yr.year + 1)).get()
    if (!next) {
      createYear(yr.year + 1, yr.rentRatePaise)
      next = db().select().from(financialYear).where(eq(financialYear.year, yr.year + 1)).get()!
      plan.createdNextYear = true
    }
    const nextYearId = next.id

    // 1. Capitalise every loan's interest at the boundary (closing balances become final).
    let interestCapitalisedPaise = 0
    let loansCapitalised = 0
    for (const l of db().select({ id: loan.id }).from(loan).where(eq(loan.yearId, yearId)).all()) {
      const r = capitaliseLoan(l.id, onDate, userId)
      if (!r) continue
      interestCapitalisedPaise += r.interestPaise
      loansCapitalised++
      plan.capVoucherIds.push(r.voucherId)
      const ev = db()
        .select({ id: loanEvent.id })
        .from(loanEvent)
        .where(and(eq(loanEvent.loanId, l.id), eq(loanEvent.type, 'capitalisation'), eq(loanEvent.date, onDate)))
        .get()
      if (ev) plan.capEventIds.push(ev.id)
    }

    // Final closing balances (now including the capitalised interest).
    const closings = carriedAccounts()
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        type: a.type,
        isSystem: a.isSystem,
        subgroupName: a.subgroupName,
        balancePaise: getAccountBalance(a.id, yearId)
      }))
      .filter((c) => c.balancePaise !== 0)
    const parties = closings.filter(isTradeParty)
    const owing = parties.filter((c) => c.balancePaise > 0)

    // 2. Carry each closing balance forward as the new year's opening.
    let totalDuesPaise = 0
    let totalCreditsPaise = 0
    for (const c of closings) {
      const preExisting = db()
        .select({ id: openingBalance.id })
        .from(openingBalance)
        .where(and(eq(openingBalance.accountId, c.accountId), eq(openingBalance.yearId, nextYearId)))
        .get()

      const drCr = c.balancePaise > 0 ? 'dr' : 'cr'
      setOpeningBalance(c.accountId, nextYearId, Math.abs(c.balancePaise), drCr, onDate, userId)
      // Dues/credits are a trade-party concept; cash & bank balances carry but aren't "dues".
      if (isTradeParty(c)) {
        if (c.balancePaise > 0) totalDuesPaise += c.balancePaise
        else totalCreditsPaise += -c.balancePaise
      }

      const ov = db()
        .select({ id: voucher.id })
        .from(voucher)
        .innerJoin(voucherEntry, eq(voucherEntry.voucherId, voucher.id))
        .where(
          and(
            eq(voucher.yearId, nextYearId),
            eq(voucher.sourceModule, 'opening'),
            eq(voucherEntry.accountId, c.accountId),
            eq(voucherEntry.tag, 'opening'),
            isNull(voucher.voidedAt)
          )
        )
        .get()
      if (ov) plan.openingVoucherIds.push(ov.id)

      if (!preExisting) {
        const nb = db()
          .select({ id: openingBalance.id })
          .from(openingBalance)
          .where(and(eq(openingBalance.accountId, c.accountId), eq(openingBalance.yearId, nextYearId)))
          .get()
        if (nb) plan.openingBalanceIds.push(nb.id)
      }
    }

    // 3. Owing dues → interest-free indirect loans for the new year (post nothing).
    let indirectLoanTotalPaise = 0
    for (const c of owing) {
      const res = createLoan(
        nextYearId,
        {
          category: loanCategoryOf(c.type),
          accountId: c.accountId,
          date: onDate,
          amountPaise: c.balancePaise,
          mode: 'cash',
          nature: 'indirect',
          interestStartDate: onDate,
          remark: `Carried-forward dues — ${yr.year} year-end close`
        },
        userId
      )
      plan.indirectLoanIds.push(res.loanId)
      indirectLoanTotalPaise += c.balancePaise
    }

    // 4. Flag every still-owing party as a defaulter (recording only the newly-flagged).
    let newDefaulters = 0
    for (const c of owing) {
      const acct = db().select({ d: account.isDefaulter }).from(account).where(eq(account.id, c.accountId)).get()
      if (acct && !acct.d) {
        setDefaulter(c.accountId, true, userId)
        plan.defaulterAccountIds.push(c.accountId)
        newDefaulters++
      }
    }

    // 5. Reset maps — implicit (the new year has no aamad/nikasi). Record what's left behind.
    const leftoverPackets = getMap(yearId, 'current').totalPackets

    const summary: CloseSummary = {
      yearId,
      year: yr.year,
      nextYear: yr.year + 1,
      accountsCarried: closings.length,
      totalDuesPaise,
      totalCreditsPaise,
      newDefaulters,
      indirectLoans: owing.length,
      indirectLoanTotalPaise,
      loansCapitalised,
      interestCapitalisedPaise,
      leftoverPackets
    }
    const exceptions = buildExceptions(yearId, parties, leftoverPackets)

    const closeRow = db()
      .insert(yearClose)
      .values({
        yearId,
        nextYearId,
        status: 'closed',
        closedByUserId: userId ?? null,
        summaryJson: JSON.stringify(summary),
        rollbackJson: JSON.stringify(plan)
      })
      .returning({ id: yearClose.id })
      .get()

    db().update(financialYear).set({ status: 'closed' }).where(eq(financialYear.id, yearId)).run()
    writeAudit({ userId, action: 'update', entity: 'year_close', entityId: closeRow.id, after: summary })

    return { closeId: closeRow.id, summary, exceptions }
  } catch (err) {
    // All-or-nothing: undo whatever was recorded so far, then surface the original error.
    applyRollback(plan, userId)
    throw err
  }
}

/** Replay a rollback plan — void the close's vouchers, delete its fresh artifacts, clear its flags. */
function applyRollback(plan: RollbackPlan, userId?: number): void {
  for (const id of plan.openingVoucherIds) voidIfLive(id, 'year-end close rolled back', userId)
  for (const id of plan.openingBalanceIds) db().delete(openingBalance).where(eq(openingBalance.id, id)).run()
  for (const id of plan.indirectLoanIds) {
    db().delete(loanEvent).where(eq(loanEvent.loanId, id)).run()
    db().delete(loan).where(eq(loan.id, id)).run()
  }
  for (const id of plan.capEventIds) db().delete(loanEvent).where(eq(loanEvent.id, id)).run()
  for (const id of plan.capVoucherIds) voidIfLive(id, 'year-end close rolled back', userId)
  for (const id of plan.defaulterAccountIds) setDefaulter(id, false, userId)
}

function voidIfLive(voucherId: number, reason: string, userId?: number): void {
  const v = db().select({ voidedAt: voucher.voidedAt }).from(voucher).where(eq(voucher.id, voucherId)).get()
  if (v && !v.voidedAt) voidVoucher(voucherId, reason, userId)
}

/**
 * Undo a close — replays the rollback plan, reopens the year, and marks the close 'rolled_back'.
 * After this the year can be closed again (re-running produces a fresh close + plan).
 *
 * **Cascades**: undoing an old year first undoes every LATER closed year, newest-first, so the
 * whole chain reopens in one action. (Its carry-forwards were computed from balances this year's
 * close fed into — leaving them closed would freeze stale numbers.) Re-closing is deliberate and
 * manual, oldest-first, so the accountant reviews each year's fresh summary.
 */
export function rollbackClose(yearId: number, userId?: number): YearCloseInfo {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)
  const laterClosed = db()
    .select({ id: financialYear.id })
    .from(financialYear)
    .where(and(gt(financialYear.year, yr.year), eq(financialYear.status, 'closed')))
    .orderBy(desc(financialYear.year))
    .all()
  for (const later of laterClosed) rollbackOne(later.id, userId)
  return rollbackOne(yearId, userId)
}

function rollbackOne(yearId: number, userId?: number): YearCloseInfo {
  const row = db()
    .select()
    .from(yearClose)
    .where(and(eq(yearClose.yearId, yearId), eq(yearClose.status, 'closed')))
    .orderBy(asc(yearClose.id))
    .all()
    .at(-1)
  if (!row) throw new Error(`Year ${yearId} has no active close to roll back`)

  const plan = JSON.parse(row.rollbackJson) as RollbackPlan
  applyRollback(plan, userId)
  db().update(financialYear).set({ status: 'open' }).where(eq(financialYear.id, yearId)).run()
  db()
    .update(yearClose)
    .set({ status: 'rolled_back', rolledBackAt: new Date() })
    .where(eq(yearClose.id, row.id))
    .run()
  writeAudit({ userId, action: 'update', entity: 'year_close', entityId: row.id, after: { status: 'rolled_back' } })

  const info = getCloseStatus(yearId)
  // getCloseStatus only returns 'closed' rows; after rollback there is none, so build from the row.
  if (info) return info
  const yr = db().select().from(financialYear).where(eq(financialYear.id, row.yearId)).get()
  const nyr = db().select().from(financialYear).where(eq(financialYear.id, row.nextYearId)).get()
  return {
    id: row.id,
    yearId: row.yearId,
    year: yr?.year ?? 0,
    nextYearId: row.nextYearId,
    nextYear: nyr?.year ?? 0,
    status: 'rolled_back',
    closedAt: row.closedAt instanceof Date ? Math.floor(row.closedAt.getTime() / 1000) : Number(row.closedAt),
    closedByUserId: row.closedByUserId,
    summary: JSON.parse(row.summaryJson) as CloseSummary
  }
}
