import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db, type Db } from '../data/db'
import { auditLog, user } from '../data/schema'
import { getSession } from '../session'
import type { AuditAction, AuditFacets, AuditFilter, AuditLogRow } from '../../shared/contracts'

export type { AuditAction } from '../../shared/contracts'

/**
 * The single audit writer. Every create/edit/void in the data layer records a row here with
 * before/after JSON + who + when (architecture.md §8). No hard deletes — vouchers are voided,
 * not removed, and the void itself is audited.
 *
 * "Who" is filled from the working session by default: every change in a login session is
 * credited to that session's accountant (the name entered at sign-in) and login user, so the
 * audit trail names the person who made each entry. Callers may still pass `userId` /
 * `accountantName` explicitly to override (e.g. tests, or actions before anyone has signed in).
 */
export interface AuditInput {
  userId?: number
  accountantName?: string
  action: AuditAction
  entity: string
  entityId?: number
  before?: unknown
  after?: unknown
}

/**
 * Write one audit row. Accepts an optional Drizzle handle so it can run inside an open
 * transaction (PostingService passes its tx); defaults to the singleton connection.
 */
export function writeAudit(input: AuditInput, handle: Db = db()): void {
  const session = getSession()
  handle
    .insert(auditLog)
    .values({
      userId: input.userId ?? session?.userId ?? null,
      accountantName: input.accountantName ?? session?.accountantName ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeJson: input.before !== undefined ? JSON.stringify(input.before) : null,
      afterJson: input.after !== undefined ? JSON.stringify(input.after) : null
    })
    .run()
}

/**
 * Read the audit trail (the Audit Trail page). Filters are ANDed; rows come back newest-first,
 * capped at `limit` (default 500). Joins the login user for its username and parses the
 * before/after JSON snapshots back into objects for the detail view.
 */
export function listAudit(filter: AuditFilter = {}): AuditLogRow[] {
  const conds = [
    filter.accountantName ? eq(auditLog.accountantName, filter.accountantName) : undefined,
    filter.entity ? eq(auditLog.entity, filter.entity) : undefined,
    filter.action ? eq(auditLog.action, filter.action) : undefined
  ].filter((c): c is NonNullable<typeof c> => c !== undefined)

  const rows = db()
    .select({
      id: auditLog.id,
      ts: auditLog.ts,
      accountantName: auditLog.accountantName,
      username: user.username,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      beforeJson: auditLog.beforeJson,
      afterJson: auditLog.afterJson
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.ts), desc(auditLog.id))
    .limit(filter.limit ?? 500)
    .all()

  return rows.map((r) => ({
    id: r.id,
    ts: r.ts.getTime(),
    accountantName: r.accountantName,
    username: r.username,
    action: r.action as AuditAction,
    entity: r.entity,
    entityId: r.entityId,
    before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
    after: r.afterJson ? JSON.parse(r.afterJson) : null
  }))
}

/** Distinct accountant names + record types present in the log, for the filter dropdowns. */
export function auditFacets(): AuditFacets {
  const accountants = db()
    .selectDistinct({ name: auditLog.accountantName })
    .from(auditLog)
    .where(isNotNull(auditLog.accountantName))
    .all()
    .map((r) => r.name as string)
    .sort((a, b) => a.localeCompare(b))
  const entities = db()
    .selectDistinct({ entity: auditLog.entity })
    .from(auditLog)
    .all()
    .map((r) => r.entity)
    .sort((a, b) => a.localeCompare(b))
  return { accountants, entities }
}
