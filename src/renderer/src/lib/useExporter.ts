import { App as AntApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { XlsxCell } from '@shared/contracts'

/**
 * Shared Excel-export helper — the spreadsheet twin of `usePrinter`. Hands the header row + the
 * rows currently on screen to `window.api.exportXlsx` (native save dialog + .xlsx write), then
 * toasts the saved path, a cancel, or an error. Every "Excel" button uses this.
 */
export function useExporter(): (
  fileName: string,
  sheetName: string,
  columns: string[],
  rows: XlsxCell[][],
  moneyColumns?: number[]
) => Promise<void> {
  const { message } = AntApp.useApp()
  const { t } = useTranslation()
  return async (fileName, sheetName, columns, rows, moneyColumns) => {
    try {
      const r = await window.api.exportXlsx(fileName, sheetName, columns, rows, moneyColumns)
      if (r.path) message.success(t('export.saved', { path: r.path }))
      else message.info(t('export.cancelled'))
    } catch (e) {
      message.error((e as Error).message || t('export.failed'))
    }
  }
}
