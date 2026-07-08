import type { SubgroupNature } from '@shared/enums'
import type { TrialBalance, TrialBalanceRow } from '@shared/contracts'

/**
 * Derive the Income Statement, Balance Sheet and category Summary from the trial balance —
 * entirely client-side, since every trial-balance row already carries its account `subgroup`
 * and `nature`. No new backend endpoint needed.
 *
 * Each statement column is grouped by subgroup (Fixed Assets, Current Assets, Cash and Bank…),
 * matching the two-tier "group heading → ledger rows → subtotal" layout of the legacy software.
 * Each row nets to one side, so `dr - cr` is the account's signed balance on its normal side.
 */

export interface StatementLine {
  name: string
  paise: number
}

/** One subgroup block within a statement column: its ledgers + their subtotal. */
export interface SubgroupSection {
  subgroup: string
  lines: StatementLine[]
  totalPaise: number
}

export interface NatureTotal {
  nature: SubgroupNature
  drPaise: number
  crPaise: number
}

export interface Financials {
  income: {
    revenue: SubgroupSection[]
    expenses: SubgroupSection[]
    totalRevenuePaise: number
    totalExpensesPaise: number
    netProfitPaise: number
  }
  balance: {
    assets: SubgroupSection[]
    liabilities: SubgroupSection[]
    equity: SubgroupSection[]
    totalAssetsPaise: number
    totalLiabilitiesPaise: number
    totalEquityPaise: number
    balanced: boolean
  }
  summary: {
    byNature: NatureTotal[]
    totalDrPaise: number
    totalCrPaise: number
    balanced: boolean
  }
}

const NATURE_ORDER: SubgroupNature[] = ['asset', 'liability', 'capital', 'income', 'expense']

/**
 * Display order of subgroups within every grouped report (Trial Balance + Financials). Follows the
 * conventional balance-sheet/P&L reading order; unknown subgroups sort last (alphabetically after).
 * The synthetic '__retained__' equity block (net profit) always closes the equity column.
 */
export const SUBGROUP_ORDER: string[] = [
  // Capital
  'Capital Account',
  '__retained__',
  // Liabilities
  'Secured Loans',
  'Sundry Creditors',
  'Duties & Taxes',
  // Assets
  'Fixed Assets',
  'Current Assets',
  'Loans & Advances (Asset)',
  'Sundry Debtors',
  'Farmer',
  'Cash and Bank',
  // Income
  'Revenue Account',
  'Income from Other Resource',
  'Indirect Income',
  // Expenses
  'Direct Expense',
  'Indirect Expense'
]

const orderIndex = (name: string): number => {
  const i = SUBGROUP_ORDER.indexOf(name)
  return i === -1 ? SUBGROUP_ORDER.length : i
}

const sum = (xs: StatementLine[]): number => xs.reduce((s, x) => s + x.paise, 0)

/** Group rows of the given natures into subgroup sections, valued on `side` (dr = debit-positive). */
function sectionsFor(
  rows: TrialBalanceRow[],
  natures: SubgroupNature[],
  side: 'dr' | 'cr'
): { sections: SubgroupSection[]; total: number } {
  const bySub = new Map<string, StatementLine[]>()
  for (const r of rows) {
    if (!natures.includes(r.nature)) continue
    const debitSide = r.drPaise - r.crPaise
    const paise = side === 'dr' ? debitSide : -debitSide
    if (paise === 0) continue // zero-balance ledgers don't appear
    const arr = bySub.get(r.subgroupName) ?? []
    arr.push({ name: r.accountName, paise })
    bySub.set(r.subgroupName, arr)
  }
  const sections = [...bySub.entries()]
    .map(([subgroup, lines]) => ({ subgroup, lines, totalPaise: sum(lines) }))
    .sort((a, b) => orderIndex(a.subgroup) - orderIndex(b.subgroup) || a.subgroup.localeCompare(b.subgroup))
  return { sections, total: sections.reduce((s, x) => s + x.totalPaise, 0) }
}

/**
 * Group any subgroup-tagged rows (e.g. TrialBalanceRow) into ordered `{ subgroup, nature, rows }`
 * blocks for two-tier rendering. Keeps the caller's row shape; ordering matches SUBGROUP_ORDER.
 */
export function groupBySubgroup<T extends { subgroupName: string; nature: SubgroupNature }>(
  rows: T[]
): { subgroup: string; nature: SubgroupNature; rows: T[] }[] {
  const groups = new Map<string, { subgroup: string; nature: SubgroupNature; rows: T[] }>()
  for (const r of rows) {
    const g = groups.get(r.subgroupName)
    if (g) g.rows.push(r)
    else groups.set(r.subgroupName, { subgroup: r.subgroupName, nature: r.nature, rows: [r] })
  }
  return [...groups.values()].sort(
    (a, b) => orderIndex(a.subgroup) - orderIndex(b.subgroup) || a.subgroup.localeCompare(b.subgroup)
  )
}

export function deriveFinancials(tb: TrialBalance): Financials {
  const rev = sectionsFor(tb.rows, ['income'], 'cr')
  const exp = sectionsFor(tb.rows, ['expense'], 'dr')
  const netProfitPaise = rev.total - exp.total

  const assets = sectionsFor(tb.rows, ['asset'], 'dr')
  const liab = sectionsFor(tb.rows, ['liability'], 'cr')
  const cap = sectionsFor(tb.rows, ['capital'], 'cr')

  // The period's profit accrues to the owners — surface it as its own equity block (retained
  // earnings) so the sheet balances against assets.
  const equity: SubgroupSection[] = [
    ...cap.sections,
    { subgroup: '__retained__', lines: [{ name: '__netProfit__', paise: netProfitPaise }], totalPaise: netProfitPaise }
  ]
  const totalEquityPaise = cap.total + netProfitPaise

  // Category summary: totals of each nature on its own side.
  const byNature: NatureTotal[] = NATURE_ORDER.map((nature) => {
    const dr = tb.rows.filter((r) => r.nature === nature).reduce((s, r) => s + r.drPaise, 0)
    const cr = tb.rows.filter((r) => r.nature === nature).reduce((s, r) => s + r.crPaise, 0)
    return { nature, drPaise: dr, crPaise: cr }
  }).filter((n) => n.drPaise !== 0 || n.crPaise !== 0)

  return {
    income: {
      revenue: rev.sections,
      expenses: exp.sections,
      totalRevenuePaise: rev.total,
      totalExpensesPaise: exp.total,
      netProfitPaise
    },
    balance: {
      assets: assets.sections,
      liabilities: liab.sections,
      equity,
      totalAssetsPaise: assets.total,
      totalLiabilitiesPaise: liab.total,
      totalEquityPaise,
      balanced: assets.total === liab.total + totalEquityPaise
    },
    summary: { byNature, totalDrPaise: tb.totalDr, totalCrPaise: tb.totalCr, balanced: tb.balanced }
  }
}
