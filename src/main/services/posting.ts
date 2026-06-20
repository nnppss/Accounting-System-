import { and, eq } from 'drizzle-orm'
import { db, type Db } from '../data/db'
import {
  numberSeries,
  voucher,
  voucherEntry,
  type EntryTag,
  type VoucherType
} from '../data/schema'
import { writeAudit } from '../audit/audit'
import type { PostResult } from '../../shared/contracts'

export type { PostResult } from '../../shared/contracts'

/**
 * PostingService — the ONE function that writes money (architecture.md §6).
 *
 * Nothing else in the app inserts into `voucher` / `voucher_entry`. Every money action
 * (manual voucher, nikasi sale, bhada accrual, loan, …) routes through `post()`, which:
 *   1. asserts Σ dr_paise === Σ cr_paise (refuses to write an unbalanced voucher),
 *   2. allocates the next per-(year, type) voucher number atomically,
 *   3. writes the header + all lines + an audit row in a single SQLite transaction.
 */

export interface PostEntryInput {
  accountId: number
  drPaise: number
  crPaise: number
  tag?: EntryTag
}

export interface PostInput {
  yearId: number
  type: VoucherType
  date: string // 'YYYY-MM-DD'
  narration?: string
  /** The logged-in accountant, stamped onto the voucher. */
  accountantUserId?: number
  /** Which module raised this voucher: 'manual' | 'nikasi' | 'bhada' | 'loan' | … */
  sourceModule?: string
  sourceId?: number
  isAuto?: boolean
  entries: PostEntryInput[]
}

/** Allocate the next serial for a (year, docType) pair, creating the series row on first use.
 * Exported so other modules (e.g. Nikasi bill numbers) can draw serials inside their own tx. */
export function nextSeries(tx: Db, yearId: number, docType: string): number {
  const existing = tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.yearId, yearId), eq(numberSeries.docType, docType)))
    .get()
  if (!existing) {
    tx.insert(numberSeries).values({ yearId, docType, currentNo: 1 }).run()
    return 1
  }
  const next = existing.currentNo + 1
  tx.update(numberSeries).set({ currentNo: next }).where(eq(numberSeries.id, existing.id)).run()
  return next
}

function assertBalanced(entries: PostEntryInput[]): void {
  if (entries.length < 2) throw new Error('A voucher needs at least two entries (one Dr, one Cr)')
  let totalDr = 0
  let totalCr = 0
  for (const e of entries) {
    if (!Number.isInteger(e.drPaise) || !Number.isInteger(e.crPaise)) {
      throw new Error('Amounts must be integer paise')
    }
    if (e.drPaise < 0 || e.crPaise < 0) throw new Error('Amounts cannot be negative')
    if (e.drPaise > 0 && e.crPaise > 0) throw new Error('An entry cannot be both Dr and Cr')
    totalDr += e.drPaise
    totalCr += e.crPaise
  }
  if (totalDr === 0) throw new Error('Voucher total cannot be zero')
  if (totalDr !== totalCr) {
    throw new Error(`Unbalanced voucher: Σdr=${totalDr} paise ≠ Σcr=${totalCr} paise`)
  }
}

/**
 * Core posting logic, given an open transaction handle. Used by `post()` and by services that
 * post inside a larger atomic write (e.g. Nikasi writes its gate pass + the sale voucher in one
 * transaction). Asserts balance, allocates the number, writes header + lines + audit.
 */
export function postCore(tx: Db, input: PostInput): PostResult {
  assertBalanced(input.entries)
  const voucherNo = nextSeries(tx, input.yearId, input.type)
  const header = tx
    .insert(voucher)
    .values({
      yearId: input.yearId,
      no: voucherNo,
      type: input.type,
      date: input.date,
      narration: input.narration ?? null,
      accountantUserId: input.accountantUserId ?? null,
      sourceModule: input.sourceModule ?? 'manual',
      sourceId: input.sourceId ?? null,
      isAuto: input.isAuto ?? false
    })
    .returning({ id: voucher.id })
    .get()

  for (const e of input.entries) {
    tx.insert(voucherEntry)
      .values({
        voucherId: header.id,
        accountId: e.accountId,
        drPaise: e.drPaise,
        crPaise: e.crPaise,
        tag: e.tag ?? 'general'
      })
      .run()
  }

  writeAudit(
    {
      userId: input.accountantUserId,
      action: 'create',
      entity: 'voucher',
      entityId: header.id,
      after: { no: voucherNo, type: input.type, date: input.date, entries: input.entries }
    },
    tx
  )

  return { voucherId: header.id, voucherNo }
}

/** Post a balanced voucher in its own transaction. Throws (writing nothing) if it doesn't balance. */
export function post(input: PostInput): PostResult {
  assertBalanced(input.entries) // fail fast before opening a transaction
  return db().transaction((tx) => postCore(tx, input))
}

/** Void a voucher (no hard deletes). Records the reason and an audit row; entries stay for trail. */
export function voidVoucher(voucherId: number, reason: string, userId?: number): void {
  db().transaction((tx) => {
    const existing = tx.select().from(voucher).where(eq(voucher.id, voucherId)).get()
    if (!existing) throw new Error(`Voucher ${voucherId} not found`)
    if (existing.voidedAt) throw new Error(`Voucher ${voucherId} is already voided`)
    tx.update(voucher)
      .set({ voidedAt: new Date(), voidedReason: reason })
      .where(eq(voucher.id, voucherId))
      .run()
    writeAudit(
      { userId, action: 'void', entity: 'voucher', entityId: voucherId, before: existing },
      tx
    )
  })
}
