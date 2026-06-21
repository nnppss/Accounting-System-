import { App as AntApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PrintResult } from '@shared/contracts'

/**
 * Shared print helper — runs a `window.api.print.*` call (which shows the native save dialog and
 * renders a PDF), then toasts the saved path, a cancel, or an error. Every Print button uses this
 * so the five document screens stay consistent.
 */
export function usePrinter(): (run: () => Promise<PrintResult>) => Promise<void> {
  const { message } = AntApp.useApp()
  const { t } = useTranslation()
  return async (run) => {
    try {
      const r = await run()
      if (r.path) message.success(t('print.saved', { path: r.path }))
      else message.info(t('print.cancelled'))
    } catch (e) {
      message.error((e as Error).message || t('print.failed'))
    }
  }
}
