import Decimal from 'decimal.js'

/**
 * Money is stored everywhere as an integer number of **paise** (1 rupee = 100 paise).
 * Never use floating-point rupees for storage or arithmetic.
 */
export type Paise = number

/** Convert rupees (number or string) to integer paise. */
export function rupeesToPaise(rupees: number | string): Paise {
  return new Decimal(rupees).times(100).round().toNumber()
}

/** Convert integer paise to a rupee number (for display only). */
export function paiseToRupees(paise: Paise): number {
  return new Decimal(paise).div(100).toNumber()
}

/** Format paise as an Indian-rupee string, e.g. 10000000 -> "₹1,00,000.00". */
export function formatINR(paise: Paise): string {
  const fixed = new Decimal(paise).div(100).toFixed(2)
  const [intPart, dec] = fixed.split('.')
  const sign = intPart.startsWith('-') ? '-' : ''
  const digits = intPart.replace('-', '')
  const last3 = digits.slice(-3)
  const rest = digits.slice(0, -3)
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
    : last3
  return `${sign}₹${grouped}.${dec}`
}

/** Sum a list of paise amounts. */
export function sum(values: Paise[]): Paise {
  return values.reduce((a, b) => a + b, 0)
}
