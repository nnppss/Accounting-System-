import { db, type Db } from '../data/db'
import { auditLog } from '../data/schema'

/**
 * The single audit writer. Every create/edit/void in the data layer records a row here with
 * before/after JSON + who + when (architecture.md §8). No hard deletes — vouchers are voided,
 * not removed, and the void itself is audited.
 */
export type AuditAction = 'create' | 'update' | 'void'

export interface AuditInput {
  userId?: number
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
  handle
    .insert(auditLog)
    .values({
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeJson: input.before !== undefined ? JSON.stringify(input.before) : null,
      afterJson: input.after !== undefined ? JSON.stringify(input.after) : null
    })
    .run()
}
