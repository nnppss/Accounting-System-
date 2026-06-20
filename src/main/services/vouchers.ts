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
import { post } from './posting'

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
    const total = db()
      .select({ dr: voucherEntry.drPaise })
      .from(voucherEntry)
      .where(eq(voucherEntry.voucherId, h.id))
      .all()
      .reduce((s, e) => s + e.dr, 0)
    return { ...h, totalPaise: total }
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
