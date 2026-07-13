import { ipcMain } from 'electron'
import type { VoucherType } from '../../shared/enums'
import type { ContraArg, JournalArg, ReceiptArg } from '../../shared/contracts'
import {
  createContra,
  createJournal,
  createPayment,
  createReceipt,
  listVouchers,
  voidManualVoucher
} from '../services/vouchers'
import { requireOpenYear, requireSession } from '../session'

export function registerVouchersIpc(): void {
  ipcMain.handle('vouchers:receipt', (_e, a: ReceiptArg) => {
    const s = requireOpenYear()
    return createReceipt({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:payment', (_e, a: ReceiptArg) => {
    const s = requireOpenYear()
    return createPayment({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:contra', (_e, a: ContraArg) => {
    const s = requireOpenYear()
    return createContra({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:journal', (_e, a: JournalArg) => {
    const s = requireOpenYear()
    return createJournal({ ...a, yearId: s.yearId, accountantUserId: s.userId })
  })
  ipcMain.handle('vouchers:list', (_e, type?: VoucherType) =>
    listVouchers(requireSession().yearId, type)
  )
  ipcMain.handle('vouchers:void', (_e, voucherId: number, reason: string) => {
    const s = requireOpenYear()
    return voidManualVoucher(s.yearId, voucherId, reason, s.userId)
  })
}
