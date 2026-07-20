import { ipcMain } from 'electron'
import type { XlsxCell } from '../../shared/contracts'
import { exportXlsx } from '../export/xlsx'
import { requireSession } from '../session'

/**
 * Excel export IPC — one generic handler. The renderer passes the header row + data rows it is
 * showing (see `export/xlsx.ts`); the session guard just ensures someone is logged in.
 */
export function registerExportIpc(): void {
  ipcMain.handle(
    'export:xlsx',
    (
      _e,
      fileName: string,
      sheetName: string,
      columns: string[],
      rows: XlsxCell[][],
      moneyColumns: number[]
    ) => {
      requireSession()
      return exportXlsx(fileName, sheetName, columns, rows, moneyColumns)
    }
  )
}
