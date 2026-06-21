import { ipcMain } from 'electron'
import type { AuditFilter } from '../../shared/contracts'
import { auditFacets, listAudit } from '../audit/audit'
import { requireSession } from '../session'

/** Audit-trail IPC — read-only views over the audit_log (who changed what, when). */
export function registerAuditIpc(): void {
  ipcMain.handle('audit:list', (_e, filter?: AuditFilter) => {
    requireSession()
    return listAudit(filter)
  })
  ipcMain.handle('audit:facets', () => {
    requireSession()
    return auditFacets()
  })
}
