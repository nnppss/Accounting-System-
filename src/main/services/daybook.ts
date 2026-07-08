import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../data/db'
import { account, voucher, voucherEntry } from '../data/schema'
import type { DayBook, DayBookVoucher } from '../../shared/contracts'

/**
 * Day Book read model — every financial transaction posted on one date (software.md day register).
 * Pure query over the ledger: all non-voided vouchers for the year on `date`, each with its
 * posting lines (account · Dr · Cr). Ordered by voucher id (insertion ≈ chronological).
 *
 * Physical-only documents (Aamad / Sauda / kisan self-withdrawal Nikasi) post no voucher, so they
 * don't appear here — this is the money day-book, not a stock-movement log.
 */
export type { DayBook, DayBookVoucher, DayBookEntry } from '../../shared/contracts'

export function getDayBook(yearId: number, date: string): DayBook {
  const rows = db()
    .select({
      voucherId: voucher.id,
      voucherNo: voucher.no,
      type: voucher.type,
      sourceModule: voucher.sourceModule,
      narration: voucher.narration,
      accountId: account.id,
      accountName: account.name,
      drPaise: voucherEntry.drPaise,
      crPaise: voucherEntry.crPaise,
      tag: voucherEntry.tag
    })
    .from(voucher)
    .innerJoin(voucherEntry, eq(voucherEntry.voucherId, voucher.id))
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .where(and(eq(voucher.yearId, yearId), eq(voucher.date, date), isNull(voucher.voidedAt)))
    .orderBy(asc(voucher.id), asc(voucherEntry.id))
    .all()

  const byVoucher = new Map<number, DayBookVoucher>()
  let totalDrPaise = 0
  let totalCrPaise = 0
  for (const r of rows) {
    let v = byVoucher.get(r.voucherId)
    if (!v) {
      v = {
        voucherId: r.voucherId,
        voucherNo: r.voucherNo,
        type: r.type,
        sourceModule: r.sourceModule,
        narration: r.narration,
        entries: []
      }
      byVoucher.set(r.voucherId, v)
    }
    v.entries.push({
      accountId: r.accountId,
      accountName: r.accountName,
      drPaise: r.drPaise,
      crPaise: r.crPaise,
      tag: r.tag
    })
    totalDrPaise += r.drPaise
    totalCrPaise += r.crPaise
  }

  return { date, vouchers: [...byVoucher.values()], totalDrPaise, totalCrPaise }
}
