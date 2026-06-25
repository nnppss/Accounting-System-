import { ipcMain } from 'electron'
import type { VoucherType } from '../../shared/enums'
import type { ContraArg, JournalArg, ReceiptArg } from '../../shared/contracts'
import {
  createContra,
  createJournal,
  createPayment,
  createReceipt,
  listVouchers
} from '../services/vouchers'
import { requireSession } from '../session'

export function registerVouchersIpc(): void {
  ipcMain.handle('vouchers:receipt', (_e, a: ReceiptArg) => {
    const s = requireSession()
    return createReceipt({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:payment', (_e, a: ReceiptArg) => {
    const s = requireSession()
    return createPayment({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:contra', (_e, a: ContraArg) => {
    const s = requireSession()
    return createContra({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:journal', (_e, a: JournalArg) => {
    const s = requireSession()
    return createJournal({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:list', (_e, type?: VoucherType) =>
    listVouchers(requireSession().yearId, type)
  )
}
