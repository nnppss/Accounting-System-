import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, openingBalance, person, subgroup, voucher, voucherEntry } from '../data/schema'
import type { DrCr } from '../../shared/enums'
import type {
  AccountInput,
  AccountListFilter,
  AccountListRow,
  PersonInput,
  SubgroupRow
} from '../../shared/contracts'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { writeAudit } from '../audit/audit'
import { post, voidVoucher } from './posting'
import { getAccountLedger, type LedgerLine } from './ledger'

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
  if (search) return q.where(like(person.name, `%${search}%`)).orderBy(asc(person.name)).all()
  return q.orderBy(asc(person.name)).all()
}

export function createAccount(input: AccountInput): number {
  const sg = db().select().from(subgroup).where(eq(subgroup.id, input.subgroupId)).get()
  if (!sg) throw new Error(`Subgroup ${input.subgroupId} does not exist`)
  if (input.personId) {
    const p = db().select().from(person).where(eq(person.id, input.personId)).get()
    if (!p) throw new Error(`Person ${input.personId} does not exist`)
  }
  const row = db()
    .insert(account)
    .values({
      name: input.name,
      type: input.type,
      subgroupId: input.subgroupId,
      personId: input.personId ?? null,
      job: input.job ?? null
    })
    .returning({ id: account.id })
    .get()
  writeAudit({ action: 'create', entity: 'account', entityId: row.id, after: input })
  return row.id
}

/** List accounts with their net balance for the given year (Dr positive). */
export function listAccounts(yearId: number, filter: AccountListFilter = {}): AccountListRow[] {
  const conds = []
  if (filter.type) conds.push(eq(account.type, filter.type))
  if (filter.search) conds.push(like(account.name, `%${filter.search}%`))
  if (!filter.includeSystem) conds.push(eq(account.isSystem, false))

  const accounts = db()
    .select({
      id: account.id,
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
