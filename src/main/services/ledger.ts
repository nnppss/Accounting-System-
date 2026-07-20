import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, cheque, person, subgroup, voucher, voucherEntry } from '../data/schema'
import { SYSTEM_ACCOUNTS } from '../data/seed'
import type { LedgerLine, TrialBalance, TrialBalanceRow } from '../../shared/contracts'

/**
 * Read models over the ledger core — pure queries, no writes (architecture.md §6).
 * If PostingService is the only writer, `getTrialBalance().totalDr` always equals `.totalCr`.
 */
export type { LedgerLine, TrialBalance, TrialBalanceRow } from '../../shared/contracts'

/** Every non-voided entry for one account in one year, newest first, each row carrying the
 *  running balance as of that transaction (computed chronologically, then displayed reversed). */
export function getAccountLedger(accountId: number, yearId: number): LedgerLine[] {
  const rows = db()
    .select({
      voucherId: voucher.id,
      voucherNo: voucher.no,
      type: voucher.type,
      sourceModule: voucher.sourceModule,
      date: voucher.date,
      narration: voucher.narration,
      tag: voucherEntry.tag,
      drPaise: voucherEntry.drPaise,
      crPaise: voucherEntry.crPaise
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(eq(voucherEntry.accountId, accountId), eq(voucher.yearId, yearId), isNull(voucher.voidedAt))
    )
    .orderBy(asc(voucher.date), asc(voucher.no), asc(voucherEntry.id))
    .all()

  const { modes, counterparties } = counterLegs(
    rows.map((r) => r.voucherId),
    accountId
  )

  let balance = 0
  return rows
    .map((r) => {
      balance += r.drPaise - r.crPaise
      return {
        ...r,
        balancePaise: balance,
        mode: modes.get(r.voucherId) ?? '',
        counterparty: counterparties.get(r.voucherId) ?? ''
      }
    })
    .reverse()
}

/**
 * Per-voucher facts read off the counter-legs (the account's own entry excluded):
 *  - `modes`: how the money moved — a cheque record wins (number + bank), else a bank counter-leg
 *    shows the bank's name and a Cash leg shows 'Cash'. Vouchers with no money leg (Bhada/Nikasi
 *    journals) don't appear, so their mode reads empty. For the Cash/bank ledgers themselves the
 *    counter-leg is the party, so mode is empty and `counterparty` carries the "with whom".
 *  - `counterparties`: every OTHER account on the voucher, deduped — the party/head the money went
 *    to or came from (fills the gap where the Cash ledger showed no party).
 */
function counterLegs(
  voucherIds: number[],
  partyAccountId: number
): { modes: Map<number, string>; counterparties: Map<number, string> } {
  const modes = new Map<number, string>()
  const counterparties = new Map<number, string>()
  if (voucherIds.length === 0) return { modes, counterparties }

  const legs = db()
    .select({ voucherId: voucherEntry.voucherId, name: account.name, type: account.type })
    .from(voucherEntry)
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .where(and(inArray(voucherEntry.voucherId, voucherIds), ne(voucherEntry.accountId, partyAccountId)))
    .all()
  const cpNames = new Map<number, string[]>()
  for (const leg of legs) {
    if (!modes.has(leg.voucherId)) {
      if (leg.type === 'bank') modes.set(leg.voucherId, leg.name)
      else if (leg.name === SYSTEM_ACCOUNTS.CASH) modes.set(leg.voucherId, 'Cash')
    }
    const list = cpNames.get(leg.voucherId) ?? []
    if (!list.includes(leg.name)) list.push(leg.name)
    cpNames.set(leg.voucherId, list)
  }
  for (const [id, names] of cpNames) counterparties.set(id, names.join(', '))

  // Cheques carry the number/bank and take precedence over the plain 'Cheques in Clearing' leg.
  const cheques = db()
    .select({ voucherId: cheque.voucherId, no: cheque.no, bank: cheque.bank })
    .from(cheque)
    .where(inArray(cheque.voucherId, voucherIds))
    .all()
  for (const c of cheques) {
    if (c.voucherId == null) continue
    modes.set(c.voucherId, `Cheque ${c.no}${c.bank ? ` — ${c.bank}` : ''}`)
  }
  return { modes, counterparties }
}

/** Net signed balance (Dr positive) for one account in one year. */
export function getAccountBalance(accountId: number, yearId: number): number {
  const row = db()
    .select({
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(eq(voucherEntry.accountId, accountId), eq(voucher.yearId, yearId), isNull(voucher.voidedAt))
    )
    .get()
  return row?.net ?? 0
}

/**
 * Per-account net balances for a year, split into Dr / Cr columns. The grand totals must be
 * equal (the books tie) when every write went through PostingService.
 */
export function getTrialBalance(yearId: number): TrialBalance {
  const sums = db()
    .select({
      accountId: account.id,
      accountName: account.name,
      sonOf: person.sonOf,
      subgroupName: subgroup.name,
      nature: subgroup.nature,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(and(eq(voucher.yearId, yearId), isNull(voucher.voidedAt)))
    .groupBy(account.id)
    .all()

  let totalDr = 0
  let totalCr = 0
  const rows: TrialBalanceRow[] = []
  for (const s of sums) {
    if (s.net === 0) continue // accounts that net to zero don't appear on the trial balance
    const drPaise = s.net > 0 ? s.net : 0
    const crPaise = s.net < 0 ? -s.net : 0
    totalDr += drPaise
    totalCr += crPaise
    rows.push({
      accountId: s.accountId,
      accountName: s.accountName,
      sonOf: s.sonOf,
      subgroupName: s.subgroupName,
      nature: s.nature,
      drPaise,
      crPaise
    })
  }
  return { rows, totalDr, totalCr, balanced: totalDr === totalCr }
}
