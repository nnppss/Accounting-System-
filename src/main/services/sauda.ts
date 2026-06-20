import { aliasedTable, and, desc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { account, sauda } from '../data/schema'
import type { SaudaInput, SaudaListRow } from '../../shared/contracts'
import { writeAudit } from '../audit/audit'

/**
 * Sauda (deal record) — a vyapari agrees a per-packet rate with a kisan (software.md §Sauda).
 * Physical only; posts nothing. Its rate is what the Nikasi sale later bills at.
 */
export type { SaudaInput, SaudaListRow } from '../../shared/contracts'

export function createSauda(yearId: number, input: SaudaInput, userId?: number): number {
  if (input.packets <= 0) throw new Error('Sauda packets must be positive')
  if (input.ratePaise < 0) throw new Error('Rate cannot be negative')
  const row = db()
    .insert(sauda)
    .values({
      yearId,
      date: input.date,
      vyapariAccountId: input.vyapariAccountId,
      kisanAccountId: input.kisanAccountId,
      packets: input.packets,
      ratePaise: input.ratePaise
    })
    .returning({ id: sauda.id })
    .get()
  writeAudit({ userId, action: 'create', entity: 'sauda', entityId: row.id, after: input })
  return row.id
}

export function listSauda(yearId: number): SaudaListRow[] {
  const vyapari = aliasedTable(account, 'vyapari')
  const kisan = aliasedTable(account, 'kisan')
  return db()
    .select({
      id: sauda.id,
      date: sauda.date,
      vyapariAccountId: sauda.vyapariAccountId,
      vyapariName: vyapari.name,
      kisanAccountId: sauda.kisanAccountId,
      kisanName: kisan.name,
      packets: sauda.packets,
      ratePaise: sauda.ratePaise
    })
    .from(sauda)
    .innerJoin(vyapari, eq(sauda.vyapariAccountId, vyapari.id))
    .innerJoin(kisan, eq(sauda.kisanAccountId, kisan.id))
    .where(eq(sauda.yearId, yearId))
    .orderBy(desc(sauda.date), desc(sauda.id))
    .all()
}

/** Most recent agreed rate for a (vyapari, kisan) pair — pre-fills the Nikasi line rate. */
export function latestRate(
  yearId: number,
  vyapariAccountId: number,
  kisanAccountId: number
): number | null {
  const row = db()
    .select({ ratePaise: sauda.ratePaise })
    .from(sauda)
    .where(
      and(
        eq(sauda.yearId, yearId),
        eq(sauda.vyapariAccountId, vyapariAccountId),
        eq(sauda.kisanAccountId, kisanAccountId)
      )
    )
    .orderBy(desc(sauda.date), desc(sauda.id))
    .get()
  return row?.ratePaise ?? null
}
