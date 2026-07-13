import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../data/db'
import { account, voucher, voucherEntry } from '../data/schema'
import type { VoucherType } from '../../shared/enums'
import type {
  ContraInput,
  JournalInput,
  PostResult,
  SimpleVoucherInput,
  VoucherDetail,
  VoucherListRow
} from '../../shared/contracts'
import { assertMoneyAccount } from './accounts'
import { post, voidVoucher } from './posting'

/**
 * Voucher constructors — convenience wrappers that build the correct Dr/Cr per the posting
 * map (architecture.md §6) and hand the balanced entries to PostingService. The renderer's
 * Receipt / Payment / Journal / Contra screens call these; nothing here writes money directly.
 */
export type {
  ContraInput,
  JournalInput,
  JournalLineInput,
  SimpleVoucherInput,
  VoucherDetail,
  VoucherListRow
} from '../../shared/contracts'

/** Receipt — a party pays the cold: Dr Cash/Bank, Cr Party. */
export function createReceipt(input: SimpleVoucherInput): PostResult {
  assertMoneyAccount(input.cashBankAccountId)
  return post({
    yearId: input.yearId,
    type: 'receipt',
    date: input.date,
    narration: input.narration,
    accountantUserId: input.accountantUserId,
    entries: [
      { accountId: input.cashBankAccountId, drPaise: input.amountPaise, crPaise: 0, tag: input.tag },
      { accountId: input.partyAccountId, drPaise: 0, crPaise: input.amountPaise, tag: input.tag }
    ]
  })
}

/** Payment — the cold pays a party: Dr Party, Cr Cash/Bank. */
export function createPayment(input: SimpleVoucherInput): PostResult {
  assertMoneyAccount(input.cashBankAccountId)
  return post({
    yearId: input.yearId,
    type: 'payment',
    date: input.date,
    narration: input.narration,
    accountantUserId: input.accountantUserId,
    entries: [
      { accountId: input.partyAccountId, drPaise: input.amountPaise, crPaise: 0, tag: input.tag },
      { accountId: input.cashBankAccountId, drPaise: 0, crPaise: input.amountPaise, tag: input.tag }
    ]
  })
}

/** Contra — cash ↔ bank transfer: Dr destination, Cr source. */
export function createContra(input: ContraInput): PostResult {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('Contra needs two different accounts')
  }
  // Contra is strictly a transfer between the cold's own cash/bank books.
  assertMoneyAccount(input.fromAccountId)
  assertMoneyAccount(input.toAccountId)
  return post({
    yearId: input.yearId,
    type: 'contra',
    date: input.date,
    narration: input.narration,
    accountantUserId: input.accountantUserId,
    entries: [
      { accountId: input.toAccountId, drPaise: input.amountPaise, crPaise: 0 },
      { accountId: input.fromAccountId, drPaise: 0, crPaise: input.amountPaise }
    ]
  })
}

/** Journal — free-form balanced entries (validated by PostingService). */
export function createJournal(input: JournalInput): PostResult {
  return post({
    yearId: input.yearId,
    type: 'journal',
    date: input.date,
    narration: input.narration,
    accountantUserId: input.accountantUserId,
    entries: input.entries
  })
}

/**
 * Void a manually-entered voucher (the correction path for the Receipt/Payment/Contra/Journal
 * screen). Only `sourceModule === 'manual'` vouchers qualify — module-raised vouchers (nikasi,
 * bhada, loan, cheque, opening…) must be reversed from their own flow so their linked state stays
 * in sync, so this refuses them. Year-scoped; a reason is required. Delegates to `voidVoucher`.
 */
export function voidManualVoucher(
  yearId: number,
  voucherId: number,
  reason: string,
  userId?: number
): void {
  if (!reason?.trim()) throw new Error('A reason is required to void a voucher')
  const v = db()
    .select()
    .from(voucher)
    .where(and(eq(voucher.id, voucherId), eq(voucher.yearId, yearId)))
    .get()
  if (!v) throw new Error(`Voucher ${voucherId} not found`)
  if (v.sourceModule !== 'manual') {
    throw new Error('Only manually-entered vouchers can be voided here — reverse this from its own screen')
  }
  voidVoucher(voucherId, reason.trim(), userId)
}

export function listVouchers(yearId: number, type?: VoucherType): VoucherListRow[] {
  const conds = [eq(voucher.yearId, yearId), isNull(voucher.voidedAt)]
  if (type) conds.push(eq(voucher.type, type))
  const headers = db()
    .select({
      id: voucher.id,
      no: voucher.no,
      type: voucher.type,
      date: voucher.date,
      narration: voucher.narration,
      isAuto: voucher.isAuto
    })
    .from(voucher)
    .where(and(...conds))
    .orderBy(desc(voucher.date), desc(voucher.no))
    .all()

  return headers.map((h) => {
    const rows = db()
      .select({ dr: voucherEntry.drPaise, tag: voucherEntry.tag })
      .from(voucherEntry)
      .where(eq(voucherEntry.voucherId, h.id))
      .all()
    const total = rows.reduce((s, e) => s + e.dr, 0)
    const tags = [...new Set(rows.map((e) => e.tag).filter((tag) => tag !== 'general'))]
    return { ...h, totalPaise: total, tags }
  })
}

export function getVoucher(voucherId: number): VoucherDetail | null {
  const h = db().select().from(voucher).where(eq(voucher.id, voucherId)).get()
  if (!h) return null
  const entries = db()
    .select({
      accountId: voucherEntry.accountId,
      accountName: account.name,
      drPaise: voucherEntry.drPaise,
      crPaise: voucherEntry.crPaise,
      tag: voucherEntry.tag
    })
    .from(voucherEntry)
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .where(eq(voucherEntry.voucherId, voucherId))
    .all()
  return {
    id: h.id,
    no: h.no,
    type: h.type,
    date: h.date,
    narration: h.narration,
    entries
  }
}
