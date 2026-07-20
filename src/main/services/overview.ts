import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, financialYear, nikasi, nikasiLine, voucher, voucherEntry } from '../data/schema'
import type { AccountOverview } from '../../shared/contracts'
import { getAccountDetail } from './accounts'
import { listAccountInterest } from './loans'

/**
 * 360° per-account snapshot for the Overview tab. Reuses the same shapes as party.ts's bulk maps
 * and loans/ledger, but scoped to one account so the page loads without building year-wide maps.
 * Money slices are net dr − cr per entry tag (excluding voided vouchers) and sum to the balance.
 */
export function getAccountOverview(accountId: number, yearId: number): AccountOverview {
  // Stock in — packets this account brought as a kisan.
  const inRow = db()
    .select({
      packets: sql<number>`coalesce(sum(${aamad.totalPackets}), 0)`,
      count: sql<number>`count(*)`
    })
    .from(aamad)
    .where(and(eq(aamad.yearId, yearId), eq(aamad.kisanAccountId, accountId)))
    .get()

  // Stock out — packets/weight of this kisan's own stock that left, across any gate pass. His stock
  // is weighed separately even when it shares a truck with other kisans' lots, so this is his
  // alone, never the vehicle's load.
  const outRow = db()
    .select({
      packets: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
      weightKg: sql<number>`coalesce(sum(${nikasiLine.weightKg}), 0)`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(and(eq(nikasi.yearId, yearId), eq(nikasiLine.fromKisanAccountId, accountId)))
    .get()

  // Purchased — packets/weight this account received as a vyapari across all gate passes.
  const purchasedRow = db()
    .select({
      packets: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
      weightKg: sql<number>`coalesce(sum(${nikasiLine.weightKg}), 0)`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(and(eq(nikasi.yearId, yearId), eq(nikasi.deliveredToAccountId, accountId)))
    .get()

  // Money by tag — net dr − cr, year-scoped, live vouchers only (mirrors getStandingLoan).
  const tagRows = db()
    .select({
      tag: voucherEntry.tag,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(eq(voucherEntry.accountId, accountId), eq(voucher.yearId, yearId), isNull(voucher.voidedAt))
    )
    .groupBy(voucherEntry.tag)
    .all()
  const byTag = (t: string): number => tagRows.find((r) => r.tag === t)?.net ?? 0

  // Live loan interest accrued but not yet capitalised into the ledger (mirrors bills.ts) — this is
  // the "total interest to date" the legacy ledger shows mid-year, before year-end capitalisation.
  const asOf = new Date().toISOString().slice(0, 10)
  const accruedInterestPaise = listAccountInterest(accountId, yearId, asOf).reduce(
    (sum, r) => sum + r.interestPaise,
    0
  )

  const rentRatePaise =
    db()
      .select({ r: financialYear.rentRatePaise })
      .from(financialYear)
      .where(eq(financialYear.id, yearId))
      .get()?.r ?? 0

  const aamadPackets = inRow?.packets ?? 0
  const nikasiOutPackets = outRow?.packets ?? 0
  const balancePaise = getAccountDetail(accountId, yearId)?.balancePaise ?? 0

  return {
    accountId,
    stock: {
      aamadPackets,
      aamadCount: inRow?.count ?? 0,
      nikasiOutPackets,
      nikasiOutWeightKg: outRow?.weightKg ?? 0,
      balancePackets: aamadPackets - nikasiOutPackets,
      purchasedPackets: purchasedRow?.packets ?? 0,
      purchasedWeightKg: purchasedRow?.weightKg ?? 0
    },
    money: {
      openingPaise: byTag('opening'),
      rentPaise: byTag('rent'),
      loanPaise: byTag('loan'),
      interestPaise: byTag('interest') + accruedInterestPaise,
      tradePaise: byTag('trade'),
      otherPaise: byTag('general'),
      balancePaise,
      newBalancePaise: balancePaise + accruedInterestPaise
    },
    rentRatePaise
  }
}
