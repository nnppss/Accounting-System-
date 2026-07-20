import { getCashBankAccounts, getRows } from './moneybook'
import type { DayBook, DayBookSection } from '../../shared/contracts'

/**
 * Day Book read model (software.md day register) — the money that moved on one date. It is the
 * Money Book sliced by day instead of by month: one section per cash/bank account, each listing
 * that account's transactions with the running balance after every one of them.
 *
 * Only money movements appear. A voucher that touches neither cash nor a bank (a Bhada accrual,
 * a Nikasi sale journal) is a book entry, not a movement of money, and belongs in the account's
 * ledger — likewise the physical-only documents (Aamad / Sauda / kisan self-withdrawal Nikasi),
 * which post no voucher at all. Accounts with no transactions on the date are left out.
 */
export type { DayBook, DayBookSection } from '../../shared/contracts'

export function getDayBook(yearId: number, date: string): DayBook {
  const sections: DayBookSection[] = []
  let totalReceiptPaise = 0
  let totalPaymentPaise = 0

  for (const a of getCashBankAccounts()) {
    const rows = getRows(a.id, yearId, (d) => d === date)
    if (rows.length === 0) continue
    // getRows is newest-first: rows[0] is the day's last movement (→ closing), the last element
    // is the day's first (→ opening = its balance backed out by its own receipt/payment).
    const oldest = rows[rows.length - 1]
    sections.push({
      accountId: a.id,
      accountName: a.name,
      openingPaise: oldest.balancePaise - oldest.receiptPaise + oldest.paymentPaise,
      closingPaise: rows[0].balancePaise,
      rows
    })
    for (const r of rows) {
      totalReceiptPaise += r.receiptPaise
      totalPaymentPaise += r.paymentPaise
    }
  }

  return { date, sections, totalReceiptPaise, totalPaymentPaise }
}
