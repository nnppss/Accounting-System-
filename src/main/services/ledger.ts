import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, subgroup, voucher, voucherEntry } from '../data/schema'
import type { LedgerLine, TrialBalance, TrialBalanceRow } from '../../shared/contracts'

/**
 * Read models over the ledger core — pure queries, no writes (architecture.md §6).
 * If PostingService is the only writer, `getTrialBalance().totalDr` always equals `.totalCr`.
 */
export type { LedgerLine, TrialBalance, TrialBalanceRow } from '../../shared/contracts'

/** Every non-voided entry for one account in one year, oldest first, with a running balance. */
export function getAccountLedger(accountId: number, yearId: number): LedgerLine[] {
  const rows = db()
    .select({
      voucherId: voucher.id,
      voucherNo: voucher.no,
      type: voucher.type,
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

  let balance = 0
  return rows.map((r) => {
    balance += r.drPaise - r.crPaise
    return { ...r, balancePaise: balance }
  })
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
      subgroupName: subgroup.name,
      nature: subgroup.nature,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
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
      subgroupName: s.subgroupName,
      nature: s.nature,
      drPaise,
      crPaise
    })
  }
  return { rows, totalDr, totalCr, balanced: totalDr === totalCr }
}
