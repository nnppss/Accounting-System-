import { app, BrowserWindow, dialog } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { eq } from 'drizzle-orm'
import { db } from '../data/db'
import { account } from '../data/schema'
import type { PrintResult } from '../../shared/contracts'
import { getNikasi } from '../services/nikasi'
import { getBill } from '../services/bills'
import { getVoucher } from '../services/vouchers'
import { getAccountLedger } from '../services/ledger'
import { getTrialBalance } from '../services/ledger'
import {
  billHtml,
  gatePassHtml,
  ledgerHtml,
  trialBalanceHtml,
  voucherHtml
} from './templates'

/**
 * Printing service (architecture.md §8) — renders one of the pure `templates.ts` HTML documents to
 * a PDF via Electron's `webContents.printToPDF`, prompting the user for a save location. This file
 * is Electron-only glue (it owns a hidden BrowserWindow + the save dialog); the HTML itself is
 * built by the unit-tested pure templates. yearId is injected by the IPC layer from the session.
 */

/** Render an HTML string to a PDF the user chooses a path for. Returns `{ path: null }` if cancelled. */
async function renderPdf(html: string, defaultFileName: string): Promise<PrintResult> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save PDF',
    defaultPath: join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { path: null }

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  const tmp = join(tmpdir(), `paritosh-print-${Date.now()}.html`)
  try {
    writeFileSync(tmp, html, 'utf-8')
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    writeFileSync(filePath, pdf)
    return { path: filePath }
  } finally {
    win.destroy()
    try {
      unlinkSync(tmp)
    } catch {
      /* temp cleanup is best-effort */
    }
  }
}

function accountName(accountId: number): string {
  const a = db().select({ name: account.name }).from(account).where(eq(account.id, accountId)).get()
  return a?.name ?? `#${accountId}`
}

export async function printGatePass(nikasiId: number): Promise<PrintResult> {
  const n = getNikasi(nikasiId)
  if (!n) throw new Error(`Nikasi ${nikasiId} not found`)
  return renderPdf(gatePassHtml(n), `gate-pass-${n.billNo}.pdf`)
}

export async function printBill(accountId: number, yearId: number, asOf?: string): Promise<PrintResult> {
  const bill = getBill(accountId, yearId, asOf)
  if (!bill) throw new Error(`No bill for account ${accountId}`)
  const safe = bill.name.replace(/[^\w]+/g, '-').toLowerCase()
  return renderPdf(billHtml(bill), `bill-${safe}.pdf`)
}

export async function printVoucher(voucherId: number): Promise<PrintResult> {
  const v = getVoucher(voucherId)
  if (!v) throw new Error(`Voucher ${voucherId} not found`)
  return renderPdf(voucherHtml(v), `voucher-${v.type}-${v.no}.pdf`)
}

export async function printLedger(accountId: number, yearId: number): Promise<PrintResult> {
  const lines = getAccountLedger(accountId, yearId)
  const name = accountName(accountId)
  const safe = name.replace(/[^\w]+/g, '-').toLowerCase()
  return renderPdf(ledgerHtml(name, lines), `ledger-${safe}.pdf`)
}

export async function printTrialBalance(yearId: number, year: number): Promise<PrintResult> {
  return renderPdf(trialBalanceHtml(year, getTrialBalance(yearId)), `trial-balance-${year}.pdf`)
}
