import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '../data/db'
import {
  account,
  accountSeries,
  openingBalance,
  person,
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
import { getAccountBalance, getAccountLedger, type LedgerLine } from './ledger'

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

/** Account-number prefix per type — e.g. a kisan account becomes K-26-0001. */
const CODE_PREFIX: Record<AccountType, string> = {
  kisan: 'K',
  vyapari: 'V',
  staff: 'S',
  loading_contractor: 'LC',
  other: 'O'
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
      job: input.job ?? null
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
    conds.push(or(like(account.name, term), like(person.name, term), like(account.code, term)))
  }
  if (filter.villageCity) conds.push(like(person.villageCity, `%${filter.villageCity.trim()}%`))
  if (filter.state) conds.push(like(person.state, `%${filter.state.trim()}%`))
  if (filter.phone) conds.push(like(person.phone, `%${filter.phone.trim()}%`))

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

export function getAccountLedgerLines(accountId: number, yearId: number): LedgerLine[] {
  return getAccountLedger(accountId, yearId)
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
 * Permanently delete a party account. Refused for the cold's own system heads, and for any account
 * that has ledger activity (a voucher entry) — those must stay for an auditable trail; mark them a
 * defaulter or leave them dormant instead. Foreign keys are the backstop if some other table still
 * references the account. Password-gating happens at the IPC layer.
 */
export function deleteAccount(accountId: number, userId?: number): void {
  const acct = db().select().from(account).where(eq(account.id, accountId)).get()
  if (!acct) throw new Error(`Account ${accountId} not found`)
  if (acct.isSystem) throw new Error('System accounts cannot be deleted')

  const used = db()
    .select({ id: voucherEntry.id })
    .from(voucherEntry)
    .where(eq(voucherEntry.accountId, accountId))
    .get()
  if (used) {
    throw new Error(
      'This account has ledger transactions and cannot be deleted. Mark it a defaulter or leave it dormant.'
    )
  }

  try {
    db().delete(account).where(eq(account.id, accountId)).run()
  } catch {
    throw new Error('This account is referenced by other records and cannot be deleted.')
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
