import { formatINR, rupeesToPaise } from '@shared/money'

export { formatINR, rupeesToPaise, paiseToRupees } from '@shared/money'

/** A signed ledger balance shown the accountant's way: amount + Dr/Cr suffix. */
export function balanceLabel(paise: number): string {
  if (paise === 0) return formatINR(0)
  return `${formatINR(Math.abs(paise))} ${paise > 0 ? 'Dr' : 'Cr'}`
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
