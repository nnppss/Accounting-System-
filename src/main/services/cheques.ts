import { aliasedTable, desc, eq, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, cheque, person, voucher } from '../data/schema'
import type { ChequeRow } from '../../shared/contracts'
import type { ChequeStatus } from '../../shared/enums'

/**
 * Cheque read models. The lifecycle (record / clear / bounce, all of which post) lives in
 * `engines/cheque-clearing.ts`; this file just lists cheques for the screen. Cheques are scoped
 * to a year through their entry voucher.
 */
export type { ChequeRow } from '../../shared/contracts'

/** Every cheque whose entry voucher belongs to `yearId`, newest first; optional status filter. */
export function listCheques(yearId: number, status?: ChequeStatus): ChequeRow[] {
  const party = aliasedTable(account, 'party')
  const bank = aliasedTable(account, 'bank')
  const rows = db()
    .select({
      id: cheque.id,
      direction: cheque.direction,
      status: cheque.status,
      partyAccountId: cheque.partyAccountId,
      partyName: party.name,
      partySonOf: person.sonOf,
      bankAccountId: cheque.bankAccountId,
      bankName: bank.name,
      amountPaise: cheque.amountPaise,
      no: cheque.no,
      bank: cheque.bank,
      date: cheque.date,
      receiveDate: cheque.receiveDate,
      clearanceDate: cheque.clearanceDate,
      yearId: voucher.yearId
    })
    .from(cheque)
    .innerJoin(voucher, eq(cheque.voucherId, voucher.id))
    .leftJoin(party, eq(cheque.partyAccountId, party.id))
    .leftJoin(person, eq(party.personId, person.id))
    .leftJoin(bank, eq(cheque.bankAccountId, bank.id))
    .where(
      status
        ? sql`${voucher.yearId} = ${yearId} and ${cheque.status} = ${status}`
        : eq(voucher.yearId, yearId)
    )
    .orderBy(desc(cheque.id))
    .all()

  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    status: r.status,
    partyAccountId: r.partyAccountId ?? 0,
    partyName: r.partyName ?? '—',
    partySonOf: r.partySonOf,
    bankAccountId: r.bankAccountId ?? 0,
    bankName: r.bankName ?? '—',
    amountPaise: r.amountPaise,
    no: r.no,
    bank: r.bank,
    date: r.date,
    receiveDate: r.receiveDate,
    clearanceDate: r.clearanceDate
  }))
}
