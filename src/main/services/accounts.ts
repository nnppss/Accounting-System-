import { and, asc, eq, inArray, isNull, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import { db } from '../data/db'
import {
  aamad,
  account,
  accountSeries,
  bardana,
  cheque,
  loan,
  nikasi,
  nikasiLine,
  openingBalance,
  person,
  sauda,
  subgroup,
  voucher,
  voucherEntry
} from '../data/schema'
import type { AccountType, DrCr } from '../../shared/enums'
import type {
  AccountDetail,
  AccountIdentityInput,
  AccountInput,
  AccountListFilter,
  AccountListRow,
  PersonInput,
  SubgroupRow
} from '../../shared/contracts'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { writeAudit } from '../audit/audit'
import { post, voidVoucher } from './posting'
import { getAccountBalance } from './ledger'

/** Account Manager service (software.md §2; phase1.md §5.4). DTOs come from the shared contract. */
export type {
  AccountInput,
  AccountListFilter,
  AccountListRow,
  PersonInput,
  SubgroupRow
} from '../../shared/contracts'

/** The 9 fixed subgroups — drives the subgroup picker on the create-account form. */
export function listSubgroups(): SubgroupRow[] {
  return db()
    .select({ id: subgroup.id, name: subgroup.name, nature: subgroup.nature })
    .from(subgroup)
    .orderBy(asc(subgroup.name))
    .all()
}

export function createPerson(input: PersonInput): number {
  const row = db()
    .insert(person)
    .values({
      name: input.name,
      sonOf: input.sonOf ?? null,
      villageCity: input.villageCity ?? null,
      state: input.state ?? null,
      phone: input.phone ?? null
    })
    .returning({ id: person.id })
    .get()
  writeAudit({ action: 'create', entity: 'person', entityId: row.id, after: input })
  return row.id
}

export function listPersons(search?: string): Array<typeof person.$inferSelect> {
  const q = db().select().from(person)
  if (search) {
    const term = `%${search.trim()}%`
    return q
      .where(
        or(
          like(person.name, term),
          like(person.sonOf, term),
          like(person.villageCity, term),
          like(person.phone, term)
        )
      )
      .orderBy(asc(person.name))
      .limit(50)
      .all()
  }
  return q.orderBy(asc(person.name)).limit(50).all()
}

/** Distinct non-empty values already saved for a person field — powers type-ahead suggestions. */
export function listPersonFieldValues(field: 'villageCity' | 'state' | 'sonOf'): string[] {
  const col = person[field]
  const rows = db()
    .select({ v: col })
    .from(person)
    .where(and(isNotNull(col), ne(col, '')))
    .orderBy(asc(col))
    .all()
  // Dedupe case-insensitively on the trimmed value ("Agra"/"agra "/"Agra" → one), keep first seen.
  const seen = new Map<string, string>()
  for (const { v } of rows) {
    const val = (v as string).trim()
    const key = val.toLowerCase()
    if (val && !seen.has(key)) seen.set(key, val)
  }
  return [...seen.values()]
}

/**
 * Delete a person from the master identity list. Refuses while any account still links to them
 * (account.personId) — those accounts must be deleted or re-pointed first. Audited.
 */
export function deletePerson(personId: number, userId?: number): void {
  const p = db().select().from(person).where(eq(person.id, personId)).get()
  if (!p) throw new Error(`Person ${personId} not found`)

  const linked = db()
    .select({ code: account.code, name: account.name })
    .from(account)
    .where(eq(account.personId, personId))
    .orderBy(asc(account.name))
    .all()
  if (linked.length > 0) {
    const list = linked.map((a) => (a.code ? `${a.code} (${a.name})` : a.name)).join(', ')
    throw new Error(
      `"${p.name}" cannot be deleted because it is still linked to ${linked.length} ` +
        `account${linked.length === 1 ? '' : 's'}: ${list}.\n\n` +
        `Delete or re-assign those accounts first, then remove this person.`
    )
  }

  db().delete(person).where(eq(person.id, personId)).run()
  writeAudit({ userId, action: 'delete', entity: 'person', entityId: personId, before: p })
}

/** Account-number prefix per type — e.g. a kisan account becomes K-26-0001. */
const CODE_PREFIX: Record<AccountType, string> = {
  kisan: 'K',
  vyapari: 'V',
  staff: 'S',
  loading_contractor: 'LC',
  bank: 'B',
  other: 'O'
}

/** The subgroup a 'bank' account is pinned to, so it always surfaces in the Money Book (seed.ts). */
const CASH_AND_BANK = 'Cash and Bank'

/**
 * Guard: `accountId` must be one of the cold's own money accounts (Cash or a bank in the
 * 'Cash and Bank' subgroup). Every service that takes a bankAccountId calls this before posting,
 * so bank money can never be routed through a party's ledger account — the Money Book and cash
 * position only ever describe the cold's own money.
 */
export function assertMoneyAccount(accountId: number): void {
  const row = db()
    .select({ accountName: account.name, subgroupName: subgroup.name })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .where(eq(account.id, accountId))
    .get()
  if (!row) throw new Error(`Account ${accountId} does not exist`)
  if (row.subgroupName !== CASH_AND_BANK) {
    throw new Error(
      `"${row.accountName}" is not a '${CASH_AND_BANK}' account — money can only move through the cold's own cash/bank books`
    )
  }
}

/** Build a human-facing account number: `<PREFIX>-<YY>-<serial>` (serial min 4 digits). */
export function formatAccountCode(type: AccountType, year: number, serial: number): string {
  const yy = String(year % 100).padStart(2, '0')
  return `${CODE_PREFIX[type]}-${yy}-${String(serial).padStart(4, '0')}`
}

/** Allocate the next per-type serial (lifetime, never resets), creating the row on first use. */
function nextAccountSerial(type: AccountType): number {
  const existing = db().select().from(accountSeries).where(eq(accountSeries.type, type)).get()
  if (!existing) {
    db().insert(accountSeries).values({ type, currentNo: 1 }).run()
    return 1
  }
  const next = existing.currentNo + 1
  db().update(accountSeries).set({ currentNo: next }).where(eq(accountSeries.type, type)).run()
  return next
}

/** Create a party account, auto-assigning its account number for the given (working) year. */
export function createAccount(input: AccountInput, year = new Date().getFullYear()): number {
  const sg = db().select().from(subgroup).where(eq(subgroup.id, input.subgroupId)).get()
  if (!sg) throw new Error(`Subgroup ${input.subgroupId} does not exist`)
  // A bank account must live in 'Cash and Bank' — that subgroup is what the Money Book filters on,
  // so misfiling one would silently leave it without a book. Enforce it beyond the UI lock.
  if (input.type === 'bank' && sg.name !== CASH_AND_BANK) {
    throw new Error(`A bank account must be in the '${CASH_AND_BANK}' subgroup`)
  }
  // …and the converse: a party filed into 'Cash and Bank' would show up in the Money Book and
  // every bank picker as if it were the cold's own money.
  if (input.type !== 'bank' && sg.name === CASH_AND_BANK) {
    throw new Error(`Only bank accounts may be in '${CASH_AND_BANK}' — it is reserved for the cold's own money`)
  }
  if (input.personId) {
    const p = db().select().from(person).where(eq(person.id, input.personId)).get()
    if (!p) throw new Error(`Person ${input.personId} does not exist`)
  }
  const code = formatAccountCode(input.type, year, nextAccountSerial(input.type))
  const row = db()
    .insert(account)
    .values({
      code,
      name: input.name,
      type: input.type,
      subgroupId: input.subgroupId,
      personId: input.personId ?? null,
      job: input.job ?? null,
      bankAccountNumber: input.bankAccountNumber?.trim() || null,
      bankIfsc: input.bankIfsc?.trim() || null,
      bankBranch: input.bankBranch?.trim() || null
    })
    .returning({ id: account.id })
    .get()
  writeAudit({ action: 'create', entity: 'account', entityId: row.id, after: { ...input, code } })
  return row.id
}

/**
 * One-time backfill: assign account numbers to any pre-existing party accounts that have none
 * (created before this feature). Idempotent — processes only null-code, non-system accounts in id
 * order, stamping each with its own creation year and the next per-type serial.
 */
export function backfillAccountCodes(): void {
  const rows = db()
    .select()
    .from(account)
    .where(and(eq(account.isSystem, false), isNull(account.code)))
    .orderBy(asc(account.id))
    .all()
  for (const a of rows) {
    const yr = a.createdAt instanceof Date ? a.createdAt.getFullYear() : new Date().getFullYear()
    const code = formatAccountCode(a.type, yr, nextAccountSerial(a.type))
    db().update(account).set({ code }).where(eq(account.id, a.id)).run()
  }
}

/** List accounts with their net balance for the given year (Dr positive). */
export function listAccounts(yearId: number, filter: AccountListFilter = {}): AccountListRow[] {
  const conds = []
  if (filter.type) conds.push(eq(account.type, filter.type))
  if (filter.name) {
    const term = `%${filter.name.trim()}%`
    conds.push(
      or(
        like(account.name, term),
        like(person.name, term),
        like(person.sonOf, term),
        like(account.code, term)
      )
    )
  }
  if (filter.villageCity) conds.push(like(person.villageCity, `%${filter.villageCity.trim()}%`))
  if (filter.state) conds.push(like(person.state, `%${filter.state.trim()}%`))
  if (filter.phone) conds.push(like(person.phone, `%${filter.phone.trim()}%`))
  if (filter.defaultersOnly) conds.push(eq(account.isDefaulter, true))

  if (filter.systemOnly) {
    conds.push(eq(account.isSystem, true))
  } else if (!filter.includeSystem) {
    conds.push(eq(account.isSystem, false))
  }

  const accounts = db()
    .select({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      subgroupName: subgroup.name,
      personName: person.name,
      personSonOf: person.sonOf,
      isDefaulter: account.isDefaulter,
      isSystem: account.isSystem
    })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(account.name))
    .all()

  if (accounts.length === 0) return []

  const ids = accounts.map((a) => a.id)
  const balances = db()
    .select({
      accountId: voucherEntry.accountId,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(and(eq(voucher.yearId, yearId), isNull(voucher.voidedAt), inArray(voucherEntry.accountId, ids)))
    .groupBy(voucherEntry.accountId)
    .all()
  const balanceByAccount = new Map(balances.map((b) => [b.accountId, b.net]))

  return accounts.map((a) => ({ ...a, balancePaise: balanceByAccount.get(a.id) ?? 0 }))
}

/**
 * Edit an account's identity fields. These live on the linked person (single source of truth), so
 * editing here updates that person — and therefore every role-account that shares them. Type and
 * subgroup are deliberately NOT editable (fixed at creation). If the account has no person yet, one
 * is created from these fields and linked.
 */
export function updateAccountIdentity(
  accountId: number,
  input: AccountIdentityInput,
  userId?: number
): void {
  const acct = db().select().from(account).where(eq(account.id, accountId)).get()
  if (!acct) throw new Error(`Account ${accountId} not found`)
  if (acct.isSystem) throw new Error('System accounts cannot be edited')

  const fields = {
    sonOf: input.sonOf?.trim() || null,
    villageCity: input.villageCity?.trim() || null,
    state: input.state?.trim() || null,
    phone: input.phone?.trim() || null
  }

  if (acct.personId) {
    const before = db().select().from(person).where(eq(person.id, acct.personId)).get()
    db().update(person).set(fields).where(eq(person.id, acct.personId)).run()
    writeAudit({
      userId,
      action: 'update',
      entity: 'person',
      entityId: acct.personId,
      before,
      after: fields
    })
  } else {
    const personId = createPerson({
      name: acct.name,
      sonOf: fields.sonOf ?? undefined,
      villageCity: fields.villageCity ?? undefined,
      state: fields.state ?? undefined,
      phone: fields.phone ?? undefined
    })
    db().update(account).set({ personId }).where(eq(account.id, accountId)).run()
    writeAudit({
      userId,
      action: 'update',
      entity: 'account',
      entityId: accountId,
      before: { personId: null },
      after: { personId }
    })
  }
}

/** Full detail for the opened-account page: identity (account + person) + balance + opening flag. */
export function getAccountDetail(accountId: number, yearId: number): AccountDetail | null {
  const row = db()
    .select({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      subgroupName: subgroup.name,
      personId: account.personId,
      personName: person.name,
      sonOf: person.sonOf,
      villageCity: person.villageCity,
      state: person.state,
      phone: person.phone,
      bankAccountNumber: account.bankAccountNumber,
      bankIfsc: account.bankIfsc,
      bankBranch: account.bankBranch,
      isDefaulter: account.isDefaulter,
      isSystem: account.isSystem
    })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(eq(account.id, accountId))
    .get()
  if (!row) return null
  const opening = db()
    .select({ accountId: openingBalance.accountId })
    .from(openingBalance)
    .where(and(eq(openingBalance.accountId, accountId), eq(openingBalance.yearId, yearId)))
    .get()
  return {
    ...row,
    balancePaise: getAccountBalance(accountId, yearId),
    hasOpening: Boolean(opening)
  }
}

export function setDefaulter(accountId: number, isDefaulter: boolean, userId?: number): void {
  const before = db().select().from(account).where(eq(account.id, accountId)).get()
  if (!before) throw new Error(`Account ${accountId} not found`)
  db().update(account).set({ isDefaulter }).where(eq(account.id, accountId)).run()
  writeAudit({
    userId,
    action: 'update',
    entity: 'account',
    entityId: accountId,
    before: { isDefaulter: before.isDefaulter },
    after: { isDefaulter }
  })
}

/**
 * Find every row, in every table, that still points at this account — collecting the actual record
 * ids so the error can name them (e.g. "sauda #1, #4"). Ordered so the most fundamental blocker
 * (ledger entries) reads first. Returns only the tables that actually reference it, each with a
 * human label, the blocking ids, and what the user must remove to clear it.
 */
function findAccountReferences(
  accountId: number
): { label: string; ids: number[]; remove: string }[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idsWhere = (table: any, idColumn: any, condition: any): number[] => {
    const rows = db().selectDistinct({ id: idColumn }).from(table).where(condition).all()
    return rows
      .map((r: { id: number | null }) => r.id)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)
  }

  // A party can appear on a nikasi as the delivery target and/or on its lines as the stock source;
  // collapse both to the parent gate-pass ids so the user sees one nikasi to remove.
  const nikasiIds = [
    ...new Set([
      ...idsWhere(nikasi, nikasi.id, eq(nikasi.deliveredToAccountId, accountId)),
      ...idsWhere(nikasiLine, nikasiLine.nikasiId, eq(nikasiLine.fromKisanAccountId, accountId))
    ])
  ].sort((a, b) => a - b)

  const checks: { label: string; ids: number[]; remove: string }[] = [
    {
      label: 'ledger voucher',
      ids: idsWhere(voucherEntry, voucherEntry.voucherId, eq(voucherEntry.accountId, accountId)),
      remove: 'these are posted vouchers — they cannot be removed; keep the account as a dormant record instead'
    },
    {
      label: 'aamad (intake)',
      ids: idsWhere(aamad, aamad.id, eq(aamad.kisanAccountId, accountId)),
      remove: 'delete the aamad entries for this party first'
    },
    {
      label: 'sauda (deal)',
      ids: idsWhere(
        sauda,
        sauda.id,
        or(eq(sauda.vyapariAccountId, accountId), eq(sauda.kisanAccountId, accountId))
      ),
      remove: 'delete the sauda entries that name this party first'
    },
    {
      label: 'nikasi (gate pass)',
      ids: nikasiIds,
      remove: 'delete the nikasi gate passes that name this party first'
    },
    {
      label: 'loan',
      ids: idsWhere(loan, loan.id, or(eq(loan.accountId, accountId), eq(loan.bankAccountId, accountId))),
      remove: 'delete the loan entries linked to this party first'
    },
    {
      label: 'bardana entry',
      ids: idsWhere(
        bardana,
        bardana.id,
        or(eq(bardana.partyAccountId, accountId), eq(bardana.bankAccountId, accountId))
      ),
      remove: 'delete the bardana entries that name this party first'
    },
    {
      label: 'cheque',
      ids: idsWhere(
        cheque,
        cheque.id,
        or(eq(cheque.partyAccountId, accountId), eq(cheque.bankAccountId, accountId))
      ),
      remove: 'delete the cheque entries linked to this party first'
    }
  ]

  return checks.filter((c) => c.ids.length > 0)
}

/** "#1, #4, #7" — capped so a long list does not bloat the message. */
function formatIds(ids: number[]): string {
  const shown = ids.slice(0, 10).map((id) => `#${id}`).join(', ')
  return ids.length > 10 ? `${shown}, …` : shown
}

/**
 * Permanently delete a party account. Refused for the cold's own system heads, and for any account
 * still referenced by a financial or physical-stock document. Before deleting we scan every table
 * that can point at the account so the error can name the exact blocker(s), their record ids, and
 * tell the user what to remove — rather than relying on the opaque foreign-key failure.
 * Password-gating happens at the IPC layer.
 */
export function deleteAccount(accountId: number, userId?: number): void {
  const acct = db().select().from(account).where(eq(account.id, accountId)).get()
  if (!acct) throw new Error(`Account ${accountId} not found`)
  if (acct.isSystem) throw new Error('System accounts cannot be deleted')

  const refs = findAccountReferences(accountId)
  if (refs.length > 0) {
    const summary = refs
      .map((r) => `${r.ids.length} ${r.label}${r.ids.length === 1 ? '' : 's'} (${formatIds(r.ids)})`)
      .join(', ')
    const steps = refs.map((r) => `• ${r.remove}`)
    // De-duplicate guidance lines (e.g. several physical docs share the same instruction).
    const uniqueSteps = [...new Set(steps)]
    throw new Error(
      `"${acct.name}" cannot be deleted because it is still referenced by: ${summary}.\n\n` +
        `To delete this account, first:\n${uniqueSteps.join('\n')}\n\n` +
        `If it has ledger transactions, the account must be kept for an auditable trail — ` +
        `mark it a defaulter or leave it dormant instead.`
    )
  }

  try {
    db().delete(account).where(eq(account.id, accountId)).run()
  } catch {
    // Backstop: a foreign key we didn't enumerate above still references the account.
    throw new Error(
      `"${acct.name}" is still referenced by another record and cannot be deleted. ` +
        `Remove the documents that name this party, then try again.`
    )
  }
  writeAudit({ userId, action: 'delete', entity: 'account', entityId: accountId, before: acct })
}

/**
 * Record an account's opening balance for a year. Stores the carry-forward row AND posts a
 * balancing 'opening' voucher against Opening Balance Equity so the trial balance stays net
 * zero. Re-setting voids the prior opening voucher first (idempotent).
 */
export function setOpeningBalance(
  accountId: number,
  yearId: number,
  amountPaise: number,
  drCr: DrCr,
  date: string,
  userId?: number
): void {
  if (amountPaise <= 0) throw new Error('Opening balance must be positive')
  const equityId = getSystemAccountId(SYSTEM_ACCOUNTS.OPENING_EQUITY)
  if (accountId === equityId) throw new Error('Cannot set an opening balance on Opening Balance Equity')

  // Void any existing 'opening' vouchers for this account+year, so re-entry replaces.
  const priorVoucherIds = db()
    .select({ id: voucher.id })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucherEntry.accountId, accountId),
        eq(voucherEntry.tag, 'opening'),
        eq(voucher.yearId, yearId),
        isNull(voucher.voidedAt)
      )
    )
    .all()
  for (const v of priorVoucherIds) voidVoucher(v.id, 'opening balance re-entered', userId)

  // Dr balance = party owes the cold; Cr balance = the cold owes the party.
  const entries =
    drCr === 'dr'
      ? [
          { accountId, drPaise: amountPaise, crPaise: 0, tag: 'opening' as const },
          { accountId: equityId, drPaise: 0, crPaise: amountPaise, tag: 'opening' as const }
        ]
      : [
          { accountId: equityId, drPaise: amountPaise, crPaise: 0, tag: 'opening' as const },
          { accountId, drPaise: 0, crPaise: amountPaise, tag: 'opening' as const }
        ]

  post({
    yearId,
    type: 'journal',
    date,
    narration: 'Opening balance',
    accountantUserId: userId,
    sourceModule: 'opening',
    isAuto: true,
    entries
  })

  db()
    .insert(openingBalance)
    .values({ accountId, yearId, amountPaise, drCr })
    .onConflictDoUpdate({
      target: [openingBalance.accountId, openingBalance.yearId],
      set: { amountPaise, drCr }
    })
    .run()
}
