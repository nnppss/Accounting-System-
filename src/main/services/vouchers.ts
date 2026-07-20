import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../data/db'
import { account, loan, voucher, voucherEntry } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { recordPayment } from './loans'
import type { VoucherType } from '../../shared/enums'
import type {
  ContraInput,
  EditVoucherInput,
  JournalInput,
  PostResult,
  SimpleVoucherInput,
  VoucherDetail,
  VoucherListRow
} from '../../shared/contracts'
import { assertMoneyAccount } from './accounts'
import { post, postCore, voidVoucher, type PostEntryInput } from './posting'
import { writeAudit } from '../audit/audit'

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

// --- Per-type Dr/Cr builders (the posting map, in one place). Shared by create and edit so
// an edited voucher re-posts with exactly the same sides as a freshly-entered one. ---

/** Receipt — a party pays the cold: Dr Cash/Bank, Cr Party. */
function receiptEntries(i: {
  cashBankAccountId: number
  partyAccountId: number
  amountPaise: number
  tag?: SimpleVoucherInput['tag']
}): PostEntryInput[] {
  // `createReceipt` diverts loan-tagged receipts to the loan module before reaching here, so a
  // 'loan' tag at this point is the edit path re-tagging a plain voucher — which would post to
  // the ledger only and leave the loan's outstanding untouched. Refuse rather than mislead.
  if (i.tag === 'loan') {
    throw new Error(
      'A receipt cannot be re-tagged Loan here — it would not reach the loan. Void it and record the repayment from the Loans screen.'
    )
  }
  assertMoneyAccount(i.cashBankAccountId)
  return [
    { accountId: i.cashBankAccountId, drPaise: i.amountPaise, crPaise: 0, tag: i.tag },
    { accountId: i.partyAccountId, drPaise: 0, crPaise: i.amountPaise, tag: i.tag }
  ]
}

/** Payment — the cold pays a party: Dr Party, Cr Cash/Bank. */
function paymentEntries(i: {
  cashBankAccountId: number
  partyAccountId: number
  amountPaise: number
  tag?: SimpleVoucherInput['tag']
}): PostEntryInput[] {
  // Money going out as a loan is a disbursement — it needs a rate, nature and interest start date
  // that a voucher has nowhere to put, so it can only be raised from the Loans screen.
  if (i.tag === 'loan') {
    throw new Error(
      'Money lent out is a new loan, not a payment voucher — record it on the Loans screen so its rate and interest are set.'
    )
  }
  assertMoneyAccount(i.cashBankAccountId)
  return [
    { accountId: i.partyAccountId, drPaise: i.amountPaise, crPaise: 0, tag: i.tag },
    { accountId: i.cashBankAccountId, drPaise: 0, crPaise: i.amountPaise, tag: i.tag }
  ]
}

/** Contra — cash ↔ bank transfer: Dr destination, Cr source. */
function contraEntries(i: {
  fromAccountId: number
  toAccountId: number
  amountPaise: number
}): PostEntryInput[] {
  if (i.fromAccountId === i.toAccountId) throw new Error('Contra needs two different accounts')
  // Contra is strictly a transfer between the cold's own cash/bank books.
  assertMoneyAccount(i.fromAccountId)
  assertMoneyAccount(i.toAccountId)
  return [
    { accountId: i.toAccountId, drPaise: i.amountPaise, crPaise: 0 },
    { accountId: i.fromAccountId, drPaise: 0, crPaise: i.amountPaise }
  ]
}

/**
 * Receipt. A 'loan' tag is a link, not a label: the Loans screen reads `loan_event`, not the
 * ledger, so a loan-tagged receipt is handed to the loan module — which accrues interest to the
 * day, posts the money and records the event — instead of being posted flat here. Anything else
 * posts as a plain Dr Cash/Bank, Cr Party.
 */
export function createReceipt(input: SimpleVoucherInput): PostResult {
  if (input.tag === 'loan') return loanRepayment(input)
  return post({ ...headerOf('receipt', input), entries: receiptEntries(input) })
}

/** A loan-tagged receipt, re-routed to `recordPayment` so the loan itself moves too. */
function loanRepayment(input: SimpleVoucherInput): PostResult {
  if (!input.loanId) {
    throw new Error('A receipt tagged Loan must say which loan it repays')
  }
  const ln = db().select().from(loan).where(eq(loan.id, input.loanId)).get()
  if (!ln) throw new Error(`Loan ${input.loanId} not found`)
  // The loan module posts against the loan's own party, so a mismatch here would silently credit
  // someone other than the party on the voucher.
  if (ln.accountId !== input.partyAccountId) {
    throw new Error('That loan belongs to a different party')
  }
  assertMoneyAccount(input.cashBankAccountId)
  const isCash = input.cashBankAccountId === getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  const r = recordPayment(
    input.loanId,
    input.amountPaise,
    input.date,
    isCash ? 'cash' : 'bank',
    isCash ? undefined : input.cashBankAccountId,
    input.accountantUserId,
    undefined,
    input.narration
  )
  return { voucherId: r.voucherId, voucherNo: r.voucherNo }
}

export function createPayment(input: SimpleVoucherInput): PostResult {
  return post({ ...headerOf('payment', input), entries: paymentEntries(input) })
}

export function createContra(input: ContraInput): PostResult {
  return post({ ...headerOf('contra', input), entries: contraEntries(input) })
}

/** Journal — free-form balanced entries (validated by PostingService). */
export function createJournal(input: JournalInput): PostResult {
  return post({ ...headerOf('journal', input), entries: input.entries })
}

function headerOf(
  type: VoucherType,
  input: { yearId: number; date: string; narration?: string; accountantUserId?: number }
): { yearId: number; type: VoucherType; date: string; narration?: string; accountantUserId?: number } {
  return {
    yearId: input.yearId,
    type,
    date: input.date,
    narration: input.narration,
    accountantUserId: input.accountantUserId
  }
}

/** Entries for an edit payload — same posting map as the create constructors. */
function editEntries(input: EditVoucherInput): PostEntryInput[] {
  switch (input.type) {
    case 'receipt':
      return receiptEntries(input)
    case 'payment':
      return paymentEntries(input)
    case 'contra':
      return contraEntries(input)
    case 'journal':
      return input.entries.map((l) => ({
        accountId: l.accountId,
        drPaise: l.drPaise,
        crPaise: l.crPaise,
        tag: l.tag
      }))
  }
}

/**
 * Edit a manually-entered voucher. Amounts/accounts can't be mutated in place (they're spread
 * across balanced entries and already summed into read-models), so an edit is a void of the old
 * voucher + a re-post of the corrected one, done atomically in one transaction. Only `manual`,
 * non-voided vouchers of the open year qualify — auto (module-raised) vouchers must be corrected
 * from their own screen. Returns the new voucher.
 */
export function updateManualVoucher(
  yearId: number,
  voucherId: number,
  input: EditVoucherInput,
  userId?: number
): PostResult {
  const entries = editEntries(input) // build + validate accounts before opening the tx
  return db().transaction((tx) => {
    const v = tx
      .select()
      .from(voucher)
      .where(and(eq(voucher.id, voucherId), eq(voucher.yearId, yearId)))
      .get()
    if (!v) throw new Error(`Voucher ${voucherId} not found`)
    if (v.sourceModule !== 'manual') {
      throw new Error('Only manually-entered vouchers can be edited here — correct this from its own screen')
    }
    if (v.voidedAt) throw new Error('Cannot edit a voided voucher')
    tx.update(voucher)
      .set({ voidedAt: new Date(), voidedReason: `Edited — replaced by re-post` })
      .where(eq(voucher.id, voucherId))
      .run()
    writeAudit({ userId, action: 'void', entity: 'voucher', entityId: voucherId, before: v }, tx)
    return postCore(tx, {
      yearId,
      type: input.type,
      date: input.date,
      narration: input.narration,
      accountantUserId: userId,
      entries
    })
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

/**
 * Edit just the narration of a posted voucher — the only field safe to change after the fact
 * (amounts/accounts are corrected by void+repost). Works for auto (module-raised) vouchers too:
 * their system narration is a starting point the accountant can refine. Year-scoped; refuses a
 * voided voucher; records the before/after in the audit trail.
 */
export function updateVoucherNarration(
  yearId: number,
  voucherId: number,
  narration: string,
  userId?: number
): void {
  db().transaction((tx) => {
    const v = tx
      .select()
      .from(voucher)
      .where(and(eq(voucher.id, voucherId), eq(voucher.yearId, yearId)))
      .get()
    if (!v) throw new Error(`Voucher ${voucherId} not found`)
    if (v.voidedAt) throw new Error('Cannot edit the narration of a voided voucher')
    const next = narration.trim() || null
    tx.update(voucher).set({ narration: next }).where(eq(voucher.id, voucherId)).run()
    writeAudit(
      {
        userId,
        action: 'update',
        entity: 'voucher',
        entityId: voucherId,
        before: { narration: v.narration },
        after: { narration: next }
      },
      tx
    )
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
    const rows = db()
      .select({
        name: account.name,
        dr: voucherEntry.drPaise,
        cr: voucherEntry.crPaise,
        tag: voucherEntry.tag
      })
      .from(voucherEntry)
      .innerJoin(account, eq(voucherEntry.accountId, account.id))
      .where(eq(voucherEntry.voucherId, h.id))
      .all()
    const total = rows.reduce((s, e) => s + e.dr, 0)
    const names = (side: (e: (typeof rows)[number]) => number): string =>
      [...new Set(rows.filter((e) => side(e) > 0).map((e) => e.name))].join(', ')
    const tags = [...new Set(rows.map((e) => e.tag).filter((tag) => tag !== 'general'))]
    return { ...h, totalPaise: total, drName: names((e) => e.dr), crName: names((e) => e.cr), tags }
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
