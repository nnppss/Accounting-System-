import { describe, expect, it } from 'vitest'
import { deriveFinancials } from './financials'
import type { TrialBalance } from './contracts'

// A tiny balanced book: 15000 owner capital → cash 12000 + equipment 3000; then 5000 cash sales
// and 2000 cash rent, leaving cash at 15000. Double-entry, so total debits == total credits.
const tb: TrialBalance = {
  rows: [
    { accountId: 1, accountName: 'Cash', subgroupName: 'Cash and Bank', nature: 'asset', drPaise: 15000, crPaise: 0 },
    { accountId: 2, accountName: 'Equipment', subgroupName: 'Fixed Assets', nature: 'asset', drPaise: 3000, crPaise: 0 },
    { accountId: 3, accountName: 'Owner Capital', subgroupName: 'Capital Account', nature: 'capital', drPaise: 0, crPaise: 15000 },
    { accountId: 4, accountName: 'Sales', subgroupName: 'Revenue Account', nature: 'income', drPaise: 0, crPaise: 5000 },
    { accountId: 5, accountName: 'Rent', subgroupName: 'Direct Expense', nature: 'expense', drPaise: 2000, crPaise: 0 }
  ],
  totalDr: 20000,
  totalCr: 20000,
  balanced: true
}

describe('deriveFinancials', () => {
  const f = deriveFinancials(tb)

  it('nets income vs expense into net profit', () => {
    expect(f.income.totalRevenuePaise).toBe(5000)
    expect(f.income.totalExpensesPaise).toBe(2000)
    expect(f.income.netProfitPaise).toBe(3000)
  })

  it('balances the sheet: assets = liabilities + equity (incl. net profit)', () => {
    expect(f.balance.totalAssetsPaise).toBe(18000) // 15000 + 3000
    expect(f.balance.totalLiabilitiesPaise).toBe(0)
    expect(f.balance.totalEquityPaise).toBe(18000) // 15000 capital + 3000 profit
    expect(f.balance.balanced).toBe(true)
  })

  it('drops zero-balance lines and categorises by nature', () => {
    expect(f.summary.byNature.map((n) => n.nature)).toEqual(['asset', 'capital', 'income', 'expense'])
  })

  it('groups each column by subgroup, ordered per SUBGROUP_ORDER', () => {
    // Fixed Assets sorts before Cash and Bank; each is its own section with a subtotal.
    expect(f.balance.assets.map((s) => s.subgroup)).toEqual(['Fixed Assets', 'Cash and Bank'])
    expect(f.balance.assets.map((s) => s.totalPaise)).toEqual([3000, 15000])
    // Equity = Capital Account block + synthetic retained-earnings (net profit) block.
    expect(f.balance.equity.map((s) => s.subgroup)).toEqual(['Capital Account', '__retained__'])
    expect(f.balance.equity.at(-1)?.totalPaise).toBe(3000)
  })
})
