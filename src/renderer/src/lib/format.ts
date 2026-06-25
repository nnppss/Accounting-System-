import type { TFunction } from 'i18next'
import { formatINR, rupeesToPaise } from '@shared/money'

export { formatINR, rupeesToPaise, paiseToRupees } from '@shared/money'

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
