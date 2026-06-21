import { eq } from 'drizzle-orm'
import { db } from '../data/db'
import { cheque, voucher } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type { ChequeInput, RecordChequeResult } from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { post, postCore } from '../services/posting'

/**
 * Cheque-clearing engine — architecture.md §7 / software.md §3.9. Cash & cheque only. A cheque
 * sits in the **"Cheques in Clearing"** system account (deliberately NOT in the 'Cash and Bank'
 * subgroup) until its clearance date; only then does it move to/from the bank — so bank books and
 * the Money Book show **cleared money only**.
 *
 * Lifecycle (each step posts via PostingService; status tracked on the `cheque` row):
 *   received  entry: Dr Clearing / Cr Party         clear: Dr Bank / Cr Clearing
 *   given     entry: Dr Party / Cr Clearing         clear: Dr Clearing / Cr Bank
 *   bounce    reverses the entry voucher (no bank movement ever happened); party owes again.
 */

function clearingAccountId(): number {
  return getSystemAccountId(SYSTEM_ACCOUNTS.CHEQUES_IN_CLEARING)
}

/** Record a cheque (status 'pending') and post its entry voucher, moving the party balance now. */
export function recordCheque(yearId: number, input: ChequeInput, userId?: number): RecordChequeResult {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Cheque amount must be a positive whole number of paise')
  }
  if (!input.no?.trim()) throw new Error('A cheque needs a number')
  const clearing = clearingAccountId()
  const entryDate = input.date ?? input.issueDate ?? new Date().toISOString().slice(0, 10)
  const received = input.direction === 'received'

  return db().transaction((tx) => {
    const row = tx
      .insert(cheque)
      .values({
        no: input.no,
        bank: input.bank ?? null,
        direction: input.direction,
        amountPaise: input.amountPaise,
        date: input.date ?? null,
        issueDate: input.issueDate ?? null,
        clearanceDate: input.clearanceDate ?? null,
        status: 'pending',
        bankAccountId: input.bankAccountId,
        partyAccountId: input.partyAccountId
      })
      .returning({ id: cheque.id })
      .get()

    // received: Dr Clearing / Cr Party (Receipt by cheque).  given: Dr Party / Cr Clearing (Payment by cheque).
    const entries = received
      ? [
          { accountId: clearing, drPaise: input.amountPaise, crPaise: 0, tag: 'general' as const },
          { accountId: input.partyAccountId, drPaise: 0, crPaise: input.amountPaise, tag: 'general' as const }
        ]
      : [
          { accountId: input.partyAccountId, drPaise: input.amountPaise, crPaise: 0, tag: 'general' as const },
          { accountId: clearing, drPaise: 0, crPaise: input.amountPaise, tag: 'general' as const }
        ]
    const res = postCore(tx, {
      yearId,
      type: received ? 'receipt' : 'payment',
      date: entryDate,
      narration: `Cheque ${input.no} ${received ? 'received' : 'given'} (in clearing)`,
      accountantUserId: userId,
      sourceModule: 'cheque',
      sourceId: row.id,
      isAuto: true,
      entries
    })
    tx.update(cheque).set({ voucherId: res.voucherId }).where(eq(cheque.id, row.id)).run()
    writeAudit({ userId, action: 'create', entity: 'cheque', entityId: row.id, after: input }, tx)
    return { chequeId: row.id, voucherId: res.voucherId }
  })
}

/** Clear a pending cheque on `clearanceDate` — the money moves into/out of the bank now. */
export function clearCheque(chequeId: number, clearanceDate: string, userId?: number): number {
  const row = db().select().from(cheque).where(eq(cheque.id, chequeId)).get()
  if (!row) throw new Error(`Cheque ${chequeId} not found`)
  if (row.status !== 'pending') throw new Error(`Cheque ${chequeId} is already ${row.status}`)
  if (!row.bankAccountId) throw new Error(`Cheque ${chequeId} has no bank account to clear into`)
  const yearId = yearOfVoucher(row.voucherId)
  const clearing = clearingAccountId()
  const received = row.direction === 'received'

  // received: Dr Bank / Cr Clearing.  given: Dr Clearing / Cr Bank.
  const entries = received
    ? [
        { accountId: row.bankAccountId, drPaise: row.amountPaise, crPaise: 0, tag: 'general' as const },
        { accountId: clearing, drPaise: 0, crPaise: row.amountPaise, tag: 'general' as const }
      ]
    : [
        { accountId: clearing, drPaise: row.amountPaise, crPaise: 0, tag: 'general' as const },
        { accountId: row.bankAccountId, drPaise: 0, crPaise: row.amountPaise, tag: 'general' as const }
      ]
  const res = post({
    yearId,
    type: 'journal',
    date: clearanceDate,
    narration: `Cheque ${row.no} cleared`,
    accountantUserId: userId,
    sourceModule: 'cheque',
    sourceId: chequeId,
    isAuto: true,
    entries
  })
  db().update(cheque).set({ status: 'cleared', clearanceDate }).where(eq(cheque.id, chequeId)).run()
  writeAudit({ userId, action: 'update', entity: 'cheque', entityId: chequeId, after: { status: 'cleared', clearanceDate } })
  return res.voucherId
}

/** Bounce a pending cheque on `date` — reverse the entry; no bank money ever moved. */
export function bounceCheque(chequeId: number, date: string, userId?: number): number {
  const row = db().select().from(cheque).where(eq(cheque.id, chequeId)).get()
  if (!row) throw new Error(`Cheque ${chequeId} not found`)
  if (row.status !== 'pending') throw new Error(`Cheque ${chequeId} is already ${row.status}`)
  const yearId = yearOfVoucher(row.voucherId)
  const clearing = clearingAccountId()
  const received = row.direction === 'received'

  // Reverse the entry: received entry was Dr Clearing/Cr Party → Dr Party/Cr Clearing; given is the mirror.
  const entries = received
    ? [
        { accountId: row.partyAccountId!, drPaise: row.amountPaise, crPaise: 0, tag: 'general' as const },
        { accountId: clearing, drPaise: 0, crPaise: row.amountPaise, tag: 'general' as const }
      ]
    : [
        { accountId: clearing, drPaise: row.amountPaise, crPaise: 0, tag: 'general' as const },
        { accountId: row.partyAccountId!, drPaise: 0, crPaise: row.amountPaise, tag: 'general' as const }
      ]
  const res = post({
    yearId,
    type: 'journal',
    date,
    narration: `Cheque ${row.no} bounced (reversed)`,
    accountantUserId: userId,
    sourceModule: 'cheque',
    sourceId: chequeId,
    isAuto: true,
    entries
  })
  db().update(cheque).set({ status: 'bounced' }).where(eq(cheque.id, chequeId)).run()
  writeAudit({ userId, action: 'update', entity: 'cheque', entityId: chequeId, after: { status: 'bounced' } })
  return res.voucherId
}

/** Resolve the financial year from the cheque's entry voucher. */
function yearOfVoucher(voucherId: number | null): number {
  if (!voucherId) throw new Error('Cheque has no entry voucher')
  const v = db().select({ yearId: voucher.yearId }).from(voucher).where(eq(voucher.id, voucherId)).get()
  if (!v) throw new Error(`Voucher ${voucherId} not found`)
  return v.yearId
}
