import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, loan, person, subgroup, voucher, voucherEntry } from '../data/schema'
import type {
  Bill,
  BillLoanLine,
  BillSection,
  BillSubject
} from '../../shared/contracts'
import type { AccountType } from '../../shared/enums'
import { getAccountLedger } from './ledger'
import { getStandingBhada } from '../engines/bhada'
import { accruedForPayment, outstandingAsOf } from '../engines/interest'
import { listBardana } from './bardana'
import { listSalaryRegister, listLoadingRegister } from './expenses'

/**
 * Bills (software.md §3.11) — a person-wise, record-to-date statement of all dealings between a
 * party and the cold. **Pure read model: posts nothing** (the ledger is the source of truth). One
 * bill per person, a section per role-account they hold (kisan / vyapari / staff / loading
 * contractor / other), plus a single combined net.
 *
 * Each section's `netPaise` = the posted ledger balance + the live loan interest that has accrued
 * but not yet been capitalised (`accruedForPayment(...).interestPaise`) — so the bill shows the
 * up-to-date figure including interest not yet in the ledger. Bardana / salary / loading rows are
 * attributed for the record but are already cash-settled, so they don't change the net.
 *
 * People are grouped by `account.personId` (one human can own several role-accounts). There is no
 * auto-merge — son-of / village / phone are only display hints.
 */
export type { Bill, BillLoanLine, BillSection, BillSubject } from '../../shared/contracts'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The loans booked against one account this year, summarised with the live engine figures. */
function loanLinesFor(accountId: number, yearId: number, asOf: string): BillLoanLine[] {
  const loans = db()
    .select()
    .from(loan)
    .where(and(eq(loan.accountId, accountId), eq(loan.yearId, yearId)))
    .orderBy(asc(loan.date), asc(loan.id))
    .all()
  return loans.map((l) => ({
    loanId: l.id,
    date: l.date,
    category: l.category,
    nature: l.nature,
    basePaise: accruedForPayment(l.id, asOf).basePaise,
    liveOutstandingPaise: outstandingAsOf(l.id, asOf).outstandingPaise,
    unpostedInterestPaise: accruedForPayment(l.id, asOf).interestPaise
  }))
}

/** Build one role-account's section of a bill. */
function sectionFor(
  acct: { id: number; name: string; type: AccountType; subgroupName: string },
  yearId: number,
  asOf: string
): BillSection {
  const ledgerLines = getAccountLedger(acct.id, yearId)
  const postedBalancePaise = ledgerLines.length ? ledgerLines[ledgerLines.length - 1].balancePaise : 0
  const loans = loanLinesFor(acct.id, yearId, asOf)
  const unpostedInterestPaise = loans.reduce((s, l) => s + l.unpostedInterestPaise, 0)
  const standingBhadaPaise = acct.type === 'kisan' ? getStandingBhada(acct.id, yearId).standingPaise : 0

  const bardanaRows = listBardana(yearId).filter((b) => b.partyAccountId === acct.id)
  const expenseRows =
    acct.type === 'staff'
      ? listSalaryRegister(yearId).filter((e) => e.partyAccountId === acct.id)
      : acct.type === 'loading_contractor'
        ? listLoadingRegister(yearId).filter((e) => e.partyAccountId === acct.id)
        : []

  return {
    accountId: acct.id,
    accountName: acct.name,
    role: acct.type,
    subgroupName: acct.subgroupName,
    ledgerLines,
    postedBalancePaise,
    standingBhadaPaise,
    loans,
    unpostedInterestPaise,
    bardanaRows,
    expenseRows,
    netPaise: postedBalancePaise + unpostedInterestPaise
  }
}

/** Every non-system account that belongs to `personId` (or just `accountId` if it has no person). */
function siblingAccounts(
  accountId: number,
  personId: number | null
): Array<{ id: number; name: string; type: AccountType; subgroupName: string }> {
  const base = db()
    .select({ id: account.id, name: account.name, type: account.type, subgroupName: subgroup.name })
    .from(account)
    .innerJoin(subgroup, eq(account.subgroupId, subgroup.id))
  const rows = personId
    ? base.where(and(eq(account.personId, personId), eq(account.isSystem, false))).all()
    : base.where(eq(account.id, accountId)).all()
  return rows.sort((a, b) => a.id - b.id)
}

/**
 * The full bill reachable from one of its role-accounts. Resolves the owning person (if linked),
 * gathers every role-account, builds a section each, and totals the combined net.
 */
export function getBill(accountId: number, yearId: number, asOf?: string): Bill | null {
  const at = asOf ?? todayIso()
  const acct = db()
    .select({ id: account.id, name: account.name, personId: account.personId })
    .from(account)
    .where(eq(account.id, accountId))
    .get()
  if (!acct) return null

  const linkedPerson = acct.personId
    ? db().select().from(person).where(eq(person.id, acct.personId)).get()
    : null

  const accounts = siblingAccounts(accountId, acct.personId)
  const sections = accounts.map((a) => sectionFor(a, yearId, at))
  const combinedNetPaise = sections.reduce((s, sec) => s + sec.netPaise, 0)

  return {
    subjectKey: acct.personId ? `person:${acct.personId}` : `account:${acct.id}`,
    personId: acct.personId,
    name: linkedPerson?.name ?? acct.name,
    sonOf: linkedPerson?.sonOf ?? null,
    villageCity: linkedPerson?.villageCity ?? null,
    phone: linkedPerson?.phone ?? null,
    sections,
    combinedNetPaise,
    asOf: at
  }
}

/**
 * The Bills index: one row per person (grouping their role-accounts) or per standalone account,
 * with the combined net. Net = posted balance + un-posted live loan interest, across the group.
 */
export function listBillSubjects(yearId: number, asOf?: string): BillSubject[] {
  const at = asOf ?? todayIso()
  const accounts = db()
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      personId: account.personId,
      personName: person.name,
      sonOf: person.sonOf,
      villageCity: person.villageCity,
      phone: person.phone
    })
    .from(account)
    .leftJoin(person, eq(account.personId, person.id))
    .where(eq(account.isSystem, false))
    .orderBy(asc(account.name))
    .all()
  if (accounts.length === 0) return []

  const ids = accounts.map((a) => a.id)

  // Posted balances in one pass (Dr positive), like Account Manager does.
  const balRows = db()
    .select({
      accountId: voucherEntry.accountId,
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(and(eq(voucher.yearId, yearId), isNull(voucher.voidedAt), inArray(voucherEntry.accountId, ids)))
    .groupBy(voucherEntry.accountId)
    .all()
  const balByAccount = new Map(balRows.map((b) => [b.accountId, b.net]))

  // Un-posted live loan interest per account.
  const loans = db()
    .select({ id: loan.id, accountId: loan.accountId })
    .from(loan)
    .where(eq(loan.yearId, yearId))
    .all()
  const interestByAccount = new Map<number, number>()
  for (const l of loans) {
    const add = accruedForPayment(l.id, at).interestPaise
    interestByAccount.set(l.accountId, (interestByAccount.get(l.accountId) ?? 0) + add)
  }

  const netFor = (id: number): number =>
    (balByAccount.get(id) ?? 0) + (interestByAccount.get(id) ?? 0)

  // Salary paid per account this year — staff carry salary slips, not ledger bills.
  const salaryByAccount = new Map<number, number>()
  for (const r of listSalaryRegister(yearId)) {
    if (r.partyAccountId == null) continue
    salaryByAccount.set(r.partyAccountId, (salaryByAccount.get(r.partyAccountId) ?? 0) + r.amountPaise)
  }

  // Group by person; accounts with no person are their own subject.
  const groups = new Map<string, typeof accounts>()
  for (const a of accounts) {
    const key = a.personId ? `person:${a.personId}` : `account:${a.id}`
    const list = groups.get(key) ?? []
    list.push(a)
    groups.set(key, list)
  }

  const subjects: BillSubject[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.id - b.id)
    const head = sorted[0]
    subjects.push({
      subjectKey: key,
      personId: head.personId,
      primaryAccountId: head.id,
      name: head.personName ?? head.name,
      sonOf: head.sonOf,
      villageCity: head.villageCity,
      phone: head.phone,
      roles: [...new Set(sorted.map((a) => a.type))],
      netPaise: sorted.reduce((s, a) => s + netFor(a.id), 0),
      salaryPaidPaise: sorted.reduce((s, a) => s + (salaryByAccount.get(a.id) ?? 0), 0)
    })
  }
  return subjects.sort((a, b) => a.name.localeCompare(b.name))
}
