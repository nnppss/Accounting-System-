import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import {
  aamad,
  account,
  bardana,
  loan,
  nikasi,
  nikasiLine,
  person,
  savedFilter,
  subgroup,
  voucher,
  voucherEntry
} from '../data/schema'
import type {
  NumericFilter,
  PartyCriteria,
  PartyResult,
  PartyRow,
  SavedFilterRow
} from '../../shared/contracts'
import { outstandingAsOf } from '../engines/interest'

/**
 * Party search (software.md §3.12) — a filter-based query/insights view over every party. **Pure
 * read model.** Filters are ANDed; numeric ones support = / ≤ / ≥ / between. Each account is scored
 * on every metric the filters can target (balance, stock, sales, rent, loans, bardana, activity),
 * then the criteria are applied. Rows carry the identity + metrics so the UI can show columns and
 * click through to the party's Bill / ledger. Presets persist in `saved_filter`.
 */
export type {
  NumericFilter,
  PartyCriteria,
  PartyResult,
  PartyRow,
  SavedFilterRow
} from '../../shared/contracts'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function matchNum(value: number, f?: NumericFilter): boolean {
  if (!f) return true
  switch (f.op) {
    case 'eq':
      return value === f.value
    case 'lte':
      return value <= f.value
    case 'gte':
      return value >= f.value
    case 'between':
      return value >= f.value && value <= (f.value2 ?? f.value)
    default:
      return true
  }
}

/** Bulk: posted signed balance (Dr positive) per account for the year. */
function balanceMap(yearId: number): Map<number, number> {
  const rows = db()
    .select({
      accountId: voucherEntry.accountId,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(and(eq(voucher.yearId, yearId), isNull(voucher.voidedAt)))
    .groupBy(voucherEntry.accountId)
    .all()
  return new Map(rows.map((r) => [r.accountId, r.net]))
}

/** Bulk: rent-tagged net (standing bhada) per account for the year. */
function standingBhadaMap(yearId: number): Map<number, number> {
  const rows = db()
    .select({
      accountId: voucherEntry.accountId,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(and(eq(voucher.yearId, yearId), eq(voucherEntry.tag, 'rent'), isNull(voucher.voidedAt)))
    .groupBy(voucherEntry.accountId)
    .all()
  return new Map(rows.map((r) => [r.accountId, r.net]))
}

/** Bulk: packets brought + aamad turns per kisan for the year. */
function aamadMap(yearId: number): Map<number, { packets: number; count: number }> {
  const rows = db()
    .select({
      kisan: aamad.kisanAccountId,
      packets: sql<number>`coalesce(sum(${aamad.totalPackets}), 0)`,
      count: sql<number>`count(*)`
    })
    .from(aamad)
    .where(eq(aamad.yearId, yearId))
    .groupBy(aamad.kisanAccountId)
    .all()
  return new Map(rows.map((r) => [r.kisan, { packets: r.packets, count: r.count }]))
}

/** Bulk: packets taken out + packets sold (to a vyapari) per kisan for the year. */
function nikasiMap(yearId: number): Map<number, { out: number; sold: number }> {
  const outRows = db()
    .select({
      kisan: nikasiLine.fromKisanAccountId,
      out: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(eq(nikasi.yearId, yearId))
    .groupBy(nikasiLine.fromKisanAccountId)
    .all()
  const soldRows = db()
    .select({
      kisan: nikasiLine.fromKisanAccountId,
      sold: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(and(eq(nikasi.yearId, yearId), eq(nikasi.deliveredToType, 'vyapari')))
    .groupBy(nikasiLine.fromKisanAccountId)
    .all()
  const m = new Map<number, { out: number; sold: number }>()
  for (const r of outRows) m.set(r.kisan, { out: r.out, sold: 0 })
  for (const r of soldRows) m.set(r.kisan, { out: m.get(r.kisan)?.out ?? 0, sold: r.sold })
  return m
}

/** Bulk: bardana pieces dealt (Σ qty) per attributed party for the year. */
function bardanaMap(yearId: number): Map<number, number> {
  const rows = db()
    .select({
      party: bardana.partyAccountId,
      qty: sql<number>`coalesce(sum(${bardana.qty}), 0)`
    })
    .from(bardana)
    .where(eq(bardana.yearId, yearId))
    .groupBy(bardana.partyAccountId)
    .all()
  const m = new Map<number, number>()
  for (const r of rows) if (r.party != null) m.set(r.party, r.qty)
  return m
}

/** Bulk: live loan outstanding per account (the engine, not the posted ledger). */
function loanOutstandingMap(yearId: number, asOf: string): Map<number, number> {
  const loans = db()
    .select({ id: loan.id, accountId: loan.accountId })
    .from(loan)
    .where(eq(loan.yearId, yearId))
    .all()
  const m = new Map<number, number>()
  for (const l of loans) {
    const add = outstandingAsOf(l.id, asOf).outstandingPaise
    m.set(l.accountId, (m.get(l.accountId) ?? 0) + add)
  }
  return m
}

/** Bulk: account ids that hold at least one loan of `category`. */
function loanCategoryAccounts(yearId: number, category: string): Set<number> {
  const rows = db()
    .select({ accountId: loan.accountId })
    .from(loan)
    .where(and(eq(loan.yearId, yearId), eq(loan.category, category as never)))
    .all()
  return new Set(rows.map((r) => r.accountId))
}

/** Bulk: account ids with any (non-void) ledger entry this year. */
function activeAccounts(yearId: number): Set<number> {
  const rows = db()
    .selectDistinct({ accountId: voucherEntry.accountId })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(and(eq(voucher.yearId, yearId), isNull(voucher.voidedAt)))
    .all()
  return new Set(rows.map((r) => r.accountId))
}

/** Bulk: person ids that own more than one account (multi-role). */
function multiRolePersons(): Set<number> {
  const rows = db()
    .select({ personId: account.personId, n: sql<number>`count(*)` })
    .from(account)
    .where(eq(account.isSystem, false))
    .groupBy(account.personId)
    .all()
  return new Set(rows.filter((r) => r.personId != null && r.n > 1).map((r) => r.personId as number))
}

/** Run the Party search (software.md §3.12): score every party, apply the ANDed criteria. */
export function searchParty(yearId: number, criteria: PartyCriteria = {}, asOf?: string): PartyResult {
  const at = asOf ?? todayIso()
  const accounts = db()
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      subgroupId: account.subgroupId,
      subgroupName: subgroup.name,
      isDefaulter: account.isDefaulter,
      personId: account.personId,
      sonOf: person.sonOf,
      villageCity: person.villageCity,
      phone: person.phone
    })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(eq(account.isSystem, false))
    .all()

  const balances = balanceMap(yearId)
  const bhada = standingBhadaMap(yearId)
  const aamads = aamadMap(yearId)
  const nikasis = nikasiMap(yearId)
  const bardanas = bardanaMap(yearId)
  const loanOut = loanOutstandingMap(yearId, at)
  const active = activeAccounts(yearId)
  const multi = criteria.multiRole ? multiRolePersons() : new Set<number>()
  const loanCatSet = criteria.loanCategory ? loanCategoryAccounts(yearId, criteria.loanCategory) : null

  const rows: PartyRow[] = []
  for (const a of accounts) {
    const balancePaise = balances.get(a.id) ?? 0
    const am = aamads.get(a.id)
    const packetsBrought = am?.packets ?? 0
    const aamadCount = am?.count ?? 0
    const nk = nikasis.get(a.id)
    const currentStock = packetsBrought - (nk?.out ?? 0)
    const packetsSold = nk?.sold ?? 0
    const standingBhadaPaise = bhada.get(a.id) ?? 0
    const loanOutstandingPaise = loanOut.get(a.id) ?? 0
    const bardanaQty = bardanas.get(a.id) ?? 0

    // identity filters
    if (criteria.type && a.type !== criteria.type) continue
    if (criteria.subgroupId && a.subgroupId !== criteria.subgroupId) continue
    if (criteria.name && !a.name.toLowerCase().includes(criteria.name.toLowerCase())) continue
    if (criteria.defaulter !== undefined && a.isDefaulter !== criteria.defaulter) continue
    if (criteria.village && !(a.villageCity ?? '').toLowerCase().includes(criteria.village.toLowerCase()))
      continue
    if (criteria.phone && !(a.phone ?? '').includes(criteria.phone)) continue
    if (criteria.multiRole && (a.personId == null || !multi.has(a.personId))) continue
    // balance filters
    if (criteria.owes === 'us' && balancePaise <= 0) continue
    if (criteria.owes === 'them' && balancePaise >= 0) continue
    // Balance side (owes) picks the direction; the amount box is a positive magnitude.
    if (!matchNum(Math.abs(balancePaise), criteria.balance)) continue
    // stock / sales filters
    if (!matchNum(packetsBrought, criteria.packetsBrought)) continue
    if (!matchNum(aamadCount, criteria.aamadCount)) continue
    if (!matchNum(currentStock, criteria.currentStock)) continue
    if (!matchNum(packetsSold, criteria.packetsSold)) continue
    // rent / loans / bardana / activity
    if (!matchNum(standingBhadaPaise, criteria.standingBhada)) continue
    if (!matchNum(loanOutstandingPaise, criteria.loanOutstanding)) continue
    if (criteria.hasLoan !== undefined && loanOutstandingPaise > 0 !== criteria.hasLoan) continue
    if (loanCatSet && !loanCatSet.has(a.id)) continue
    if (!matchNum(bardanaQty, criteria.bardanaQty)) continue
    if (criteria.hasActivity !== undefined && active.has(a.id) !== criteria.hasActivity) continue

    rows.push({
      accountId: a.id,
      personId: a.personId,
      name: a.name,
      sonOf: a.sonOf,
      villageCity: a.villageCity,
      phone: a.phone,
      type: a.type,
      subgroupName: a.subgroupName,
      isDefaulter: a.isDefaulter,
      balancePaise,
      packetsBrought,
      aamadCount,
      currentStock,
      packetsSold,
      standingBhadaPaise,
      loanOutstandingPaise,
      bardanaQty
    })
  }

  rows.sort((a, b) => a.name.localeCompare(b.name))
  return {
    rows,
    count: rows.length,
    totalBalancePaise: rows.reduce((s, r) => s + r.balancePaise, 0),
    totalLoanOutstandingPaise: rows.reduce((s, r) => s + r.loanOutstandingPaise, 0)
  }
}

// ---- saved presets ----

export function listSavedFilters(module: string, userId?: number): SavedFilterRow[] {
  const rows = db()
    .select()
    .from(savedFilter)
    .where(eq(savedFilter.module, module))
    .all()
  return rows
    .filter((r) => userId === undefined || r.userId === userId || r.userId === null)
    .map((r) => ({
      id: r.id,
      module: r.module,
      name: r.name,
      criteria: JSON.parse(r.criteriaJson) as PartyCriteria
    }))
}

export function saveFilter(
  module: string,
  name: string,
  criteria: PartyCriteria,
  userId?: number
): number {
  if (!name.trim()) throw new Error('A preset needs a name')
  const row = db()
    .insert(savedFilter)
    .values({ userId: userId ?? null, module, name: name.trim(), criteriaJson: JSON.stringify(criteria) })
    .returning({ id: savedFilter.id })
    .get()
  return row.id
}

export function deleteSavedFilter(id: number): void {
  db().delete(savedFilter).where(eq(savedFilter.id, id)).run()
}
