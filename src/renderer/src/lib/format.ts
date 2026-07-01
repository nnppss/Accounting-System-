import type { TFunction } from 'i18next'
import dayjs from 'dayjs'
import { formatINR, rupeesToPaise } from '@shared/money'

export { formatINR, rupeesToPaise, paiseToRupees } from '@shared/money'

/**
 * The one display format for dates across the whole app: DD/MM/YYYY.
 * Use this for antd `DatePicker`/`RangePicker` `format` props. Stored/serialized dates stay ISO
 * (`YYYY-MM-DD`) — this only governs what the user sees.
 */
export const DATE_FORMAT = 'DD/MM/YYYY'

/**
 * Format a stored date for display as DD/MM/YYYY. Accepts an ISO string (`YYYY-MM-DD`), an epoch-ms
 * timestamp, or a dayjs-parseable value. Empty/invalid input is returned/blanked safely.
 */
export function formatDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const d = dayjs(value)
  return d.isValid() ? d.format(DATE_FORMAT) : String(value)
}

/** A signed ledger balance shown the accountant's way: amount + Dr/Cr suffix. */
export function balanceLabel(paise: number): string {
  if (paise === 0) return formatINR(0)
  return `${formatINR(Math.abs(paise))} ${paise > 0 ? 'Dr' : 'Cr'}`
}

/**
 * The same balance spelled out for a layman: who owes whom, by name. Sign convention matches the
 * ledger — positive (Dr) means the party owes the cold, negative (Cr) means the cold owes the party.
 * Localized, so it follows the selected language.
 */
export function balanceSentence(t: TFunction, name: string, paise: number): string {
  if (paise === 0) return t('balance.settled', { name })
  const amount = formatINR(Math.abs(paise))
  return paise > 0
    ? t('balance.partyOwes', { name, amount })
    : t('balance.coldOwes', { name, amount })
}

/** Convert a rupee amount from an InputNumber (may be null) to integer paise. */
export function toPaise(rupees: number | null | undefined): number {
  if (rupees === null || rupees === undefined) return 0
  return rupeesToPaise(rupees)
}

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const
