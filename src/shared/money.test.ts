import { describe, it, expect } from 'vitest'
import { rupeesToPaise, paiseToRupees, formatINR, sum } from './money'

describe('money (paise)', () => {
  it('converts rupees to paise exactly', () => {
    expect(rupeesToPaise(1500)).toBe(150000)
    expect(rupeesToPaise('1234.56')).toBe(123456)
    expect(rupeesToPaise(0.1)).toBe(10)
  })

  it('round-trips paise <-> rupees', () => {
    expect(paiseToRupees(150000)).toBe(1500)
    expect(paiseToRupees(123456)).toBe(1234.56)
  })

  it('formats Indian-style grouping', () => {
    expect(formatINR(150000)).toBe('₹1,500.00') // 1,500
    expect(formatINR(10000000)).toBe('₹1,00,000.00') // 1 lakh
    expect(formatINR(1000000000)).toBe('₹1,00,00,000.00') // 1 crore
    expect(formatINR(10000000000)).toBe('₹10,00,00,000.00') // 10 crore
    expect(formatINR(-50000)).toBe('-₹500.00')
    expect(formatINR(0)).toBe('₹0.00')
  })

  it('sums amounts', () => {
    expect(sum([100, 200, 300])).toBe(600)
    expect(sum([])).toBe(0)
  })
})
