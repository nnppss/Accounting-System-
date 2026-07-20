import { ipcMain } from 'electron'
import type { VoucherType } from '../../shared/enums'
import type { ContraArg, EditVoucherInput, JournalArg, ReceiptArg } from '../../shared/contracts'
import {
  createContra,
  createJournal,
  createPayment,
  createReceipt,
  getVoucher,
  listVouchers,
  updateManualVoucher,
  updateVoucherNarration,
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
  ipcMain.handle('vouchers:get', (_e, voucherId: number) => getVoucher(voucherId))
  ipcMain.handle('vouchers:update', (_e, voucherId: number, input: EditVoucherInput) => {
    const s = requireOpenYear()
    return updateManualVoucher(s.yearId, voucherId, input, s.userId)
  })
  ipcMain.handle('vouchers:void', (_e, voucherId: number, reason: string) => {
    const s = requireOpenYear()
    return voidManualVoucher(s.yearId, voucherId, reason, s.userId)
  })
  ipcMain.handle('vouchers:updateNarration', (_e, voucherId: number, narration: string) => {
    const s = requireOpenYear()
    return updateVoucherNarration(s.yearId, voucherId, narration, s.userId)
  })
}
