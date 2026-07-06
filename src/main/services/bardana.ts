import { and, desc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { account, bardana, voucher } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type { BardanaAccount, BardanaInput, BardanaRow, CreateBardanaResult } from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { assertMoneyAccount } from './accounts'
import { postCore } from './posting'

/**
 * Bardana (bags) buy/sell sub-ledger — software.md §3.7, posting map architecture.md §6. The cold
 * trades bags independently of stored packets. `amountPaise = ratePaise × qty` (pieces). A deal is
 * not always settled upfront: `paidPaise` is what changed hands in cash/bank now; the rest stays
 * owed on the named party's ledger (tag 'trade'). So bardana can be paid in full, paid partly, or
 * left fully on credit. The Bardana A/C stays a pure aggregate over the goods value (stock count +
 * profit), independent of how the deal was paid.
 *
 * Posting map — when a party is named, the FULL goods value routes through their ledger so every
 * deal is documented there (net balance = what's still owed, unchanged):
 *   purchase  Dr Bardana Purchase (amount) / Cr Party (amount, 'trade')
 *             + Dr Party (paid, 'trade') / Cr Cash-Bank (paid)      — the payment leg, if any
 *   issue     Dr Party (amount, 'trade') / Cr Bardana Sales (amount)
 *             + Dr Cash-Bank (paid) / Cr Party (paid, 'trade')      — the receipt leg, if any
 *   no party (fully paid over the counter): Bardana head ↔ Cash-Bank directly.
 *   voucher type: payment/receipt when cash moves, else journal (full credit).
 */
export type { BardanaAccount, BardanaInput, BardanaRow, CreateBardanaResult } from '../../shared/contracts'

/** Record a bardana purchase/issue and post its voucher in one transaction. */
export function createBardana(yearId: number, input: BardanaInput, userId?: number): CreateBardanaResult {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error('Bardana quantity must be a positive whole number of pieces')
  }
  if (!Number.isInteger(input.ratePaise) || input.ratePaise < 0) {
    throw new Error('Bardana rate must be a non-negative whole number of paise')
  }
  const amountPaise = input.ratePaise * input.qty
  if (amountPaise <= 0) throw new Error('Bardana amount cannot be zero')

  // Omitting paidPaise means "settled in full" — keeps the simple cash deal a one-liner.
  const paidPaise = input.paidPaise ?? amountPaise
  if (!Number.isInteger(paidPaise) || paidPaise < 0) {
    throw new Error('Bardana paid amount must be a non-negative whole number of paise')
  }
  if (paidPaise > amountPaise) {
    throw new Error('Bardana paid amount cannot exceed the deal amount')
  }
  const creditPaise = amountPaise - paidPaise

  // Anything left unpaid has to live on someone's ledger.
  if (creditPaise > 0 && !input.partyAccountId) {
    throw new Error('An unpaid (credit) bardana needs a party to carry the balance')
  }
  // The cash/bank leg only exists when money actually moves now.
  if (paidPaise > 0 && input.mode === 'bank') {
    if (!input.bankAccountId) throw new Error('A bank settlement needs a bank account')
    assertMoneyAccount(input.bankAccountId)
  }
  // A pre-booking is a sale we owe bags against — meaningless for a purchase, and it needs a
  // named party to deliver to later.
  if (input.prebooked && input.direction !== 'issue') {
    throw new Error('Only an issue (sale) can be pre-booked')
  }
  if (input.prebooked && !input.partyAccountId) {
    throw new Error('A pre-booking needs a party to deliver to later')
  }

  const cashBank =
    paidPaise > 0
      ? input.mode === 'cash'
        ? getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
        : input.bankAccountId!
      : null
  const purchase = input.direction === 'purchase'
  const bardanaHead = getSystemAccountId(
    purchase ? SYSTEM_ACCOUNTS.BARDANA_PURCHASE : SYSTEM_ACCOUNTS.BARDANA_SALES
  )

  return db().transaction((tx) => {
    const row = tx
      .insert(bardana)
      .values({
        yearId,
        direction: input.direction,
        date: input.date,
        partyAccountId: input.partyAccountId ?? null,
        ratePaise: input.ratePaise,
        qty: input.qty,
        amountPaise,
        paidPaise,
        // mode is meaningless when no cash moves (pure credit); default it so the NOT NULL holds.
        mode: paidPaise > 0 ? input.mode : (input.mode ?? 'cash'),
        bankAccountId: paidPaise > 0 && input.mode === 'bank' ? (input.bankAccountId ?? null) : null,
        prebooked: input.prebooked ?? false
      })
      .returning({ id: bardana.id })
      .get()

    // With a named party the full goods value routes through their ledger (so the deal is
    // documented there even when fully paid), and the paid portion posts back as a payment leg —
    // net party balance = the outstanding credit. Without a party (fully paid, validated above)
    // the Bardana head settles against cash/bank directly.
    const entries: { accountId: number; drPaise: number; crPaise: number; tag: 'general' | 'trade' }[] = []
    const party = input.partyAccountId
    if (purchase) {
      entries.push({ accountId: bardanaHead, drPaise: amountPaise, crPaise: 0, tag: 'general' })
      if (party) {
        entries.push({ accountId: party, drPaise: 0, crPaise: amountPaise, tag: 'trade' })
        if (paidPaise > 0) entries.push({ accountId: party, drPaise: paidPaise, crPaise: 0, tag: 'trade' })
      }
      if (paidPaise > 0) entries.push({ accountId: cashBank!, drPaise: 0, crPaise: paidPaise, tag: 'general' })
    } else {
      if (paidPaise > 0) entries.push({ accountId: cashBank!, drPaise: paidPaise, crPaise: 0, tag: 'general' })
      if (party) {
        entries.push({ accountId: party, drPaise: amountPaise, crPaise: 0, tag: 'trade' })
        if (paidPaise > 0) entries.push({ accountId: party, drPaise: 0, crPaise: paidPaise, tag: 'trade' })
      }
      entries.push({ accountId: bardanaHead, drPaise: 0, crPaise: amountPaise, tag: 'general' })
    }

    const res = postCore(tx, {
      yearId,
      // Cash moved → payment (we paid) / receipt (we received). Pure credit → journal.
      type: paidPaise > 0 ? (purchase ? 'payment' : 'receipt') : 'journal',
      date: input.date,
      narration:
        `Bardana ${input.direction}${input.prebooked ? ' (pre-booked)' : ''} — ` +
        `${input.qty} pcs @ ₹${input.ratePaise / 100}/pc` +
        (input.remark?.trim() ? ` — ${input.remark.trim()}` : ''),
      accountantUserId: userId,
      sourceModule: 'bardana',
      sourceId: row.id,
      isAuto: true,
      entries
    })
    tx.update(bardana).set({ voucherId: res.voucherId }).where(eq(bardana.id, row.id)).run()
    writeAudit({ userId, action: 'create', entity: 'bardana', entityId: row.id, after: { ...input, amountPaise, paidPaise } }, tx)
    return { bardanaId: row.id, voucherId: res.voucherId }
  })
}

/**
 * Hand over a pre-booked issue: the money side was posted at booking time, so delivery is purely
 * physical — clear the flag (freeing the reservation) and leave the trail to the audit log.
 */
export function deliverBardana(yearId: number, id: number, userId?: number): void {
  db().transaction((tx) => {
    const row = tx
      .select()
      .from(bardana)
      .where(and(eq(bardana.id, id), eq(bardana.yearId, yearId)))
      .get()
    if (!row) throw new Error(`Bardana ${id} not found`)
    if (!row.prebooked) throw new Error(`Bardana ${id} is not an undelivered pre-booking`)
    tx.update(bardana).set({ prebooked: false }).where(eq(bardana.id, id)).run()
    writeAudit({ userId, action: 'update', entity: 'bardana', entityId: id, before: row, after: { ...row, prebooked: false } }, tx)
  })
}

/**
 * Delete a bardana transaction. Its auto-posted voucher (purchase → payment, issue → receipt) is
 * voided first so the cash/bank and bardana heads reverse out of every balance — no hard ledger
 * deletes; the voided voucher stays for the trail. Scoped to the year, atomic, and audited.
 */
export function deleteBardana(yearId: number, id: number, userId?: number): void {
  db().transaction((tx) => {
    const row = tx
      .select()
      .from(bardana)
      .where(and(eq(bardana.id, id), eq(bardana.yearId, yearId)))
      .get()
    if (!row) throw new Error(`Bardana ${id} not found`)

    if (row.voucherId) {
      const v = tx.select().from(voucher).where(eq(voucher.id, row.voucherId)).get()
      if (v && !v.voidedAt) {
        tx.update(voucher)
          .set({ voidedAt: new Date(), voidedReason: `Bardana entry #${row.id} deleted` })
          .where(eq(voucher.id, row.voucherId))
          .run()
        writeAudit({ userId, action: 'void', entity: 'voucher', entityId: row.voucherId, before: v }, tx)
      }
    }

    tx.delete(bardana).where(eq(bardana.id, id)).run()
    writeAudit({ userId, action: 'delete', entity: 'bardana', entityId: id, before: row }, tx)
  })
}

/** Every bardana transaction for the year, newest first (optionally a single direction). */
export function listBardana(yearId: number, direction?: BardanaRow['direction']): BardanaRow[] {
  const rows = db()
    .select({ bardana, partyName: account.name })
    .from(bardana)
    .leftJoin(account, eq(bardana.partyAccountId, account.id))
    .where(eq(bardana.yearId, yearId))
    .orderBy(desc(bardana.date), desc(bardana.id))
    .all()
  // Resolve bank names in a second pass (small data; keeps the join simple).
  return rows
    .filter((r) => !direction || r.bardana.direction === direction)
    .map((r) => rowFrom(r.bardana, r.partyName))
}

function rowFrom(b: typeof bardana.$inferSelect, partyName: string | null): BardanaRow {
  const bankName = b.bankAccountId
    ? (db().select({ name: account.name }).from(account).where(eq(account.id, b.bankAccountId)).get()?.name ?? null)
    : null
  return {
    id: b.id,
    direction: b.direction,
    date: b.date,
    partyAccountId: b.partyAccountId,
    partyName,
    ratePaise: b.ratePaise,
    qty: b.qty,
    amountPaise: b.amountPaise,
    paidPaise: b.paidPaise,
    mode: b.mode,
    bankAccountId: b.bankAccountId,
    bankName,
    prebooked: b.prebooked
  }
}

/**
 * The Bardana A/C (software.md §3.7): two lists + totals, the bardana stock count
 * (Σpurchased − Σissued, pieces), and profit (Σsales − Σpurchases, paise).
 */
export function getBardanaAccount(yearId: number): BardanaAccount {
  const all = listBardana(yearId)
  const purchases = all.filter((r) => r.direction === 'purchase')
  const issues = all.filter((r) => r.direction === 'issue')
  const totalPurchasesPaise = purchases.reduce((s, r) => s + r.amountPaise, 0)
  const totalSalesPaise = issues.reduce((s, r) => s + r.amountPaise, 0)
  const purchasedQty = purchases.reduce((s, r) => s + r.qty, 0)
  const issuedQty = issues.reduce((s, r) => s + r.qty, 0)
  return {
    purchases,
    issues,
    totalPurchasesPaise,
    totalSalesPaise,
    // Pre-booked issues count as issued here, so stockCount is what's still free to sell;
    // reservedQty is on top of it, physically in the store until delivered.
    stockCount: purchasedQty - issuedQty,
    reservedQty: issues.filter((r) => r.prebooked).reduce((s, r) => s + r.qty, 0),
    profitPaise: totalSalesPaise - totalPurchasesPaise
  }
}
