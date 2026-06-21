import { registerAccountsIpc } from './accounts'
import { registerAuditIpc } from './audit'
import { registerAuthIpc } from './auth'
import { registerCloseIpc } from './close'
import { registerExpensesIpc } from './expenses'
import { registerLedgerIpc } from './ledger'
import { registerLoansIpc } from './loans'
import { registerMoneyBookIpc } from './moneybook'
import { registerPrintIpc } from './print'
import { registerStockIpc } from './stock'
import { registerViewsIpc } from './views'
import { registerVouchersIpc } from './vouchers'

/** Register every IPC handler — the typed API surface the renderer reaches through preload. */
export function registerIpc(): void {
  registerAuthIpc()
  registerAccountsIpc()
  registerVouchersIpc()
  registerLedgerIpc()
  registerMoneyBookIpc()
  registerStockIpc()
  registerLoansIpc()
  registerExpensesIpc()
  registerViewsIpc()
  registerCloseIpc()
  registerPrintIpc()
  registerAuditIpc()
}
