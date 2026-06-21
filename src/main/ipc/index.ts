import { registerAccountsIpc } from './accounts'
import { registerAuthIpc } from './auth'
import { registerExpensesIpc } from './expenses'
import { registerLedgerIpc } from './ledger'
import { registerLoansIpc } from './loans'
import { registerMoneyBookIpc } from './moneybook'
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
}
