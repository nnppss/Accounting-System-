import { and, desc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { account, bardana, voucher } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type { BardanaAccount, BardanaInput, BardanaRow, CreateBardanaResult } from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { postCore } from './posting'

/**
 * Bardana (bags) buy/sell sub-ledger — software.md §3.7, posting map architecture.md §6. The cold
 * trades bags independently of stored packets. `amountPaise = ratePaise × qty` (pieces). A deal is
 * not always settled upfront: `paidPaise` is what changed hands in cash/bank now, and the rest is
 * carried on the named party's own ledger (tag 'trade'), exactly like a Nikasi sale. So bardana can
 * be paid in full, paid partly, or left fully on credit. The Bardana A/C stays a pure aggregate over
 * the goods value (stock count + profit), independent of how the deal was paid.
 *
 * Posting map — let cash = paidPaise, credit = amountPaise − paidPaise:
 *   purchase  Dr Bardana Purchase (amount) / Cr Cash-Bank (cash) + Cr Party (credit, 'trade')
 *   issue     Dr Cash-Bank (cash) + Dr Party (credit, 'trade') / Cr Bardana Sales (amount)
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
  if (paidPaise > 0 && input.mode === 'bank' && !input.bankAccountId) {
    throw new Error('A bank settlement needs a bank account')
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
        mode: input.mode,
        bankAccountId: paidPaise > 0 && input.mode === 'bank' ? (input.bankAccountId ?? null) : null
      })
      .returning({ id: bardana.id })
      .get()

    // Bardana head takes the full goods value; the contra side splits cash (paid) vs party (credit).
    // For a purchase the contra is on the Cr side; for an issue it is on the Dr side.
    const contra: { accountId: number; paise: number; tag: 'general' | 'trade' }[] = []
    if (paidPaise > 0) contra.push({ accountId: cashBank!, paise: paidPaise, tag: 'general' })
    if (creditPaise > 0) contra.push({ accountId: input.partyAccountId!, paise: creditPaise, tag: 'trade' })

    const entries = purchase
      ? [
          { accountId: bardanaHead, drPaise: amountPaise, crPaise: 0, tag: 'general' as const },
          ...contra.map((c) => ({ accountId: c.accountId, drPaise: 0, crPaise: c.paise, tag: c.tag }))
        ]
      : [
          ...contra.map((c) => ({ accountId: c.accountId, drPaise: c.paise, crPaise: 0, tag: c.tag })),
          { accountId: bardanaHead, drPaise: 0, crPaise: amountPaise, tag: 'general' as const }
        ]

    const res = postCore(tx, {
      yearId,
      // Cash moved → payment (we paid) / receipt (we received). Pure credit → journal.
      type: paidPaise > 0 ? (purchase ? 'payment' : 'receipt') : 'journal',
      date: input.date,
      narration: `Bardana ${input.direction} — ${input.qty} pcs @ ${input.ratePaise} paise`,
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
    bankName
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
    stockCount: purchasedQty - issuedQty,
    profitPaise: totalSalesPaise - totalPurchasesPaise
  }
}
