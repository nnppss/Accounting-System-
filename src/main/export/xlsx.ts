import { app, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import ExcelJS from 'exceljs'
import type { PrintResult, XlsxCell } from '../../shared/contracts'

/**
 * Excel export — the spreadsheet counterpart of `printing/print.ts`. The renderer already renders
 * every one of these tables, so it hands us the header row + data rows it is showing (numbers left
 * as numbers so the accountant can sum/filter in Excel) and we just write the .xlsx. One generic
 * writer, no per-document code: all column/format decisions live next to each table in the UI.
 */
/** Indian lakh/crore digit grouping, 2 decimals — e.g. 2511000 → 25,11,000.00. App convention. */
const MONEY_FMT = '#,##,##0.00'

export async function exportXlsx(
  fileName: string,
  sheetName: string,
  columns: string[],
  rows: XlsxCell[][],
  moneyColumns: number[] = []
): Promise<PrintResult> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Excel',
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (canceled || !filePath) return { path: null }

  const wb = new ExcelJS.Workbook()
  // Excel caps sheet names at 31 chars and forbids [ ] : * ? / \.
  const ws = wb.addWorksheet(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1')
  ws.addRow(columns).font = { bold: true }
  rows.forEach((r) => ws.addRow(r))
  const money = new Set(moneyColumns)
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    // Indian grouping on money columns (numFmt is ignored on the text header + blank cells).
    if (money.has(i)) col.numFmt = MONEY_FMT
    // Size each column to its widest cell (else the viewer opens with narrow, truncated columns).
    // Money cells render longer than their raw value (".00" + group separators), so pad for that.
    const shown = (v: XlsxCell): number =>
      v == null ? 0 : money.has(i) && typeof v === 'number' ? v.toFixed(2).length + 3 : String(v).length
    const max = rows.reduce((m, r) => Math.max(m, shown(r[i])), c.length)
    col.width = Math.min(60, max + 2)
  })
  writeFileSync(filePath, Buffer.from(await wb.xlsx.writeBuffer()))
  return { path: filePath }
}
