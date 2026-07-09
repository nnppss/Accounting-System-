import { app, BrowserWindow, dialog } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { eq } from 'drizzle-orm'
import { db } from '../data/db'
import { account } from '../data/schema'
import type {
  AamadListRow,
  BardanaRow,
  ExpenseRow,
  LoanRow,
  NikasiListRow,
  PartyRow,
  PrintResult,
  SaudaListRow
} from '../../shared/contracts'
import { getNikasi } from '../services/nikasi'
import { getBill } from '../services/bills'
import { getVoucher } from '../services/vouchers'
import { getAccountLedger } from '../services/ledger'
import { getTrialBalance } from '../services/ledger'
import { getAccountDetail } from '../services/accounts'
import { getSummary as getMoneyBookSummary, getDetail as getMoneyBookDetail, getCashBankAccounts } from '../services/moneybook'
import { getDayBook } from '../services/daybook'
import { getAamad } from '../services/aamad'
import { getLoan, getLoanComposition } from '../services/loans'
import { getBardanaAccount } from '../services/bardana'
import { deriveFinancials } from '../../shared/financials'
import {
  aamadReceiptHtml,
  aamadRegisterHtml,
  bardanaHtml,
  billHtml,
  dayBookHtml,
  expenseRegisterHtml,
  financialsHtml,
  gatePassHtml,
  ledgerHtml,
  loanRegisterHtml,
  loanStatementHtml,
  moneyBookDetailHtml,
  moneyBookSummaryHtml,
  nikasiRegisterHtml,
  partyHtml,
  saudaRegisterHtml,
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
  const acct = getAccountDetail(accountId, yearId)
  const name = acct?.name ?? accountName(accountId)
  const safe = name.replace(/[^\w]+/g, '-').toLowerCase()
  return renderPdf(ledgerHtml(name, lines, acct), `ledger-${safe}.pdf`)
}

export async function printTrialBalance(yearId: number, year: number): Promise<PrintResult> {
  return renderPdf(trialBalanceHtml(year, getTrialBalance(yearId)), `trial-balance-${year}.pdf`)
}

/** A stored cash/bank account's display name for money-book document titles. */
function moneyAccountName(accountId: number): string {
  return getCashBankAccounts().find((a) => a.id === accountId)?.name ?? `#${accountId}`
}

export async function printMoneyBookSummary(accountId: number, yearId: number, year: number): Promise<PrintResult> {
  const name = moneyAccountName(accountId)
  return renderPdf(moneyBookSummaryHtml(name, year, getMoneyBookSummary(accountId, yearId)), `money-book-${year}.pdf`)
}

export async function printMoneyBookDetail(accountId: number, month: number, yearId: number, year: number): Promise<PrintResult> {
  const name = moneyAccountName(accountId)
  const rows = getMoneyBookDetail(accountId, yearId, month)
  return renderPdf(moneyBookDetailHtml(name, year, month, rows), `money-book-${year}-${month}.pdf`)
}

export async function printDayBook(date: string, yearId: number): Promise<PrintResult> {
  return renderPdf(dayBookHtml(getDayBook(yearId, date)), `day-book-${date}.pdf`)
}

export async function printFinancials(yearId: number, year: number): Promise<PrintResult> {
  return renderPdf(financialsHtml(year, deriveFinancials(getTrialBalance(yearId))), `financials-${year}.pdf`)
}

export async function printAamadReceipt(aamadId: number): Promise<PrintResult> {
  const a = getAamad(aamadId)
  if (!a) throw new Error(`Aamad ${aamadId} not found`)
  return renderPdf(aamadReceiptHtml(a), `aamad-${a.no}.pdf`)
}

export async function printLoanStatement(loanId: number): Promise<PrintResult> {
  const d = getLoan(loanId)
  if (!d) throw new Error(`Loan ${loanId} not found`)
  const safe = d.accountName.replace(/[^\w]+/g, '-').toLowerCase()
  return renderPdf(loanStatementHtml(d, getLoanComposition(loanId)), `loan-${safe}.pdf`)
}

// Registers take the rows shown on screen (post client-side filter) + a filter subtitle, so the
// PDF is exactly what the user sees. Global summaries (bardana account) are still fetched here.

export async function printAamadRegister(subtitle: string, rows: AamadListRow[]): Promise<PrintResult> {
  return renderPdf(aamadRegisterHtml(subtitle, rows), 'aamad-register.pdf')
}

export async function printSaudaRegister(rows: SaudaListRow[]): Promise<PrintResult> {
  return renderPdf(saudaRegisterHtml(rows), 'sauda-register.pdf')
}

export async function printNikasiRegister(subtitle: string, rows: NikasiListRow[]): Promise<PrintResult> {
  return renderPdf(nikasiRegisterHtml(subtitle, rows), 'nikasi-register.pdf')
}

export async function printExpenseRegister(
  subtitle: string,
  rows: Array<ExpenseRow & { kind: 'salary' | 'loading' }>
): Promise<PrintResult> {
  return renderPdf(expenseRegisterHtml(subtitle, rows), 'expense-register.pdf')
}

export async function printBardana(subtitle: string, rows: BardanaRow[], yearId: number): Promise<PrintResult> {
  return renderPdf(bardanaHtml(subtitle, getBardanaAccount(yearId), rows), 'bardana-account.pdf')
}

export async function printLoanRegister(rows: LoanRow[]): Promise<PrintResult> {
  return renderPdf(loanRegisterHtml(rows), 'loan-register.pdf')
}

export async function printParty(subtitle: string, rows: PartyRow[]): Promise<PrintResult> {
  return renderPdf(partyHtml(subtitle, rows), 'party-report.pdf')
}
