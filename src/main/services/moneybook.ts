import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '../data/db'
import { account, subgroup, voucher, voucherEntry } from '../data/schema'
import type {
  CashBankAccount,
  MoneyBookDetailRow,
  MoneyBookMonth,
  MoneyBookSummary
} from '../../shared/contracts'

/**
 * Money Book read model (software.md §Money Book; phase1.md §5.5) — the cold's cash & bank
 * book. Pure queries over the ledger: Cash plus one book per bank account (subgroup
 * 'Cash and Bank'). For a cash/bank account a Dr is money in (receipt), a Cr is money out
 * (payment). The opening column comes from 'opening'-tagged entries so injected opening cash
 * shows as the opening balance, not as a January receipt.
 */
export type {
  CashBankAccount,
  MoneyBookDetailRow,
  MoneyBookMonth,
  MoneyBookSummary
} from '../../shared/contracts'

const CASH_AND_BANK = 'Cash and Bank'

export function getCashBankAccounts(): CashBankAccount[] {
  return db()
    .select({ id: account.id, name: account.name })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .where(eq(subgroup.name, CASH_AND_BANK))
    .orderBy(asc(account.name))
    .all()
}

export function getSummary(accountId: number, yearId: number): MoneyBookSummary {
  const rows = db()
    .select({
      date: voucher.date,
      dr: voucherEntry.drPaise,
      cr: voucherEntry.crPaise,
      tag: voucherEntry.tag
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(eq(voucherEntry.accountId, accountId), eq(voucher.yearId, yearId), isNull(voucher.voidedAt))
    )
    .all()

  let openingTotal = 0
  const receipts = new Array(13).fill(0)
  const payments = new Array(13).fill(0)
  for (const r of rows) {
    if (r.tag === 'opening') {
      openingTotal += r.dr - r.cr
      continue
    }
    const month = Number(r.date.slice(5, 7))
    receipts[month] += r.dr
    payments[month] += r.cr
  }

  const months: MoneyBookMonth[] = []
  let running = openingTotal
  for (let m = 1; m <= 12; m++) {
    const openingPaise = running
    const closingPaise = openingPaise + receipts[m] - payments[m]
    months.push({
      month: m,
      openingPaise,
      receiptsPaise: receipts[m],
      paymentsPaise: payments[m],
      closingPaise
    })
    running = closingPaise
  }
  return { months, openingPaise: openingTotal, closingPaise: running }
}

/** The individual transactions behind one month of a cash/bank book. */
export function getDetail(accountId: number, yearId: number, month: number): MoneyBookDetailRow[] {
  const mm = String(month).padStart(2, '0')
  return getRows(accountId, yearId, (date) => date.slice(5, 7) === mm)
}

/**
 * The cash/bank account's transactions whose date passes `inScope`, each carrying the running
 * balance *at that point in the year* — so the balance after the last row of a month equals that
 * month's closing in the summary. For a cash/bank book a Dr adds, a Cr subtracts.
 */
export function getRows(
  accountId: number,
  yearId: number,
  inScope: (date: string) => boolean
): MoneyBookDetailRow[] {
  const entries = db()
    .select({
      entryId: voucherEntry.id,
      voucherId: voucher.id,
      voucherNo: voucher.no,
      type: voucher.type,
      date: voucher.date,
      narration: voucher.narration,
      dr: voucherEntry.drPaise,
      cr: voucherEntry.crPaise
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(eq(voucherEntry.accountId, accountId), eq(voucher.yearId, yearId), isNull(voucher.voidedAt))
    )
    // Within a date, id (insertion ≈ chronological) is the only sound tie-break: voucher numbers
    // run as a separate series per type, so ordering by `no` interleaves receipts and payments and
    // walks the running balance out of order.
    .orderBy(asc(voucher.date), asc(voucher.id))
    .all()

  // Walk the whole year in order and keep the scoped rows with the balance as it stood then.
  let running = 0
  const scoped = entries.flatMap((e) => {
    running += e.dr - e.cr
    return inScope(e.date) ? [{ ...e, balancePaise: running }] : []
  })
  if (scoped.length === 0) return []

  // Counterparty = the other accounts on each voucher (everything that isn't this account).
  const voucherIds = [...new Set(scoped.map((e) => e.voucherId))]
  const others = db()
    .select({ voucherId: voucherEntry.voucherId, id: account.id, name: account.name })
    .from(voucherEntry)
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .where(and(inArray(voucherEntry.voucherId, voucherIds), ne(voucherEntry.accountId, accountId)))
    .all()
  const counterpartyByVoucher = new Map<number, { id: number; name: string }[]>()
  for (const o of others) {
    const list = counterpartyByVoucher.get(o.voucherId) ?? []
    if (!list.some((c) => c.id === o.id)) list.push({ id: o.id, name: o.name })
    counterpartyByVoucher.set(o.voucherId, list)
  }

  // Balance is walked chronologically above; display newest-first (each row keeps its own balance).
  return scoped
    .map((e) => ({
      voucherId: e.voucherId,
      voucherNo: e.voucherNo,
      type: e.type,
      date: e.date,
      narration: e.narration,
      counterparties: counterpartyByVoucher.get(e.voucherId) ?? [],
      receiptPaise: e.dr,
      paymentPaise: e.cr,
      balancePaise: e.balancePaise
    }))
    .reverse()
}
