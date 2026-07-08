import { useState } from 'react'
import { Card, Input, Segmented, Table } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { SubgroupNature } from '@shared/enums'
import { formatINR } from '../lib/format'
import { deriveFinancials, type Financials, type StatementLine, type SubgroupSection } from '../lib/financials'
import { PageBanner, SectionBar, StatusPill } from '../components/report'

type View = 'income' | 'balance' | 'summary'
type Side = 'Dr' | 'Cr'

/** Amount with its Dr/Cr side; a contra balance (negative on its normal side) flips to the other side. */
const fmtSide = (paise: number, side: Side): string =>
  `${formatINR(Math.abs(paise))} ${paise >= 0 ? side : side === 'Dr' ? 'Cr' : 'Dr'}`

/**
 * Financial Statements — Income Statement, Balance Sheet and category Summary, all derived from the
 * trial balance (see lib/financials.ts). Mirrors the Rippling "Financial Statements" + "Summary"
 * sheets: sectioned two-column statements with a balance check.
 */
export default function FinancialsPage(): JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('income')
  const [search, setSearch] = useState('')
  const tb = useQuery({ queryKey: ['trialBalance'], queryFn: () => window.api.ledger.trialBalance() })

  // Searching drills into a subset: re-derive the statements from the matching ledgers, so
  // subtotals/totals reflect what's shown (clearing the box restores the full, balanced statement).
  const q = search.trim().toLowerCase()
  const f = (() => {
    if (!tb.data) return undefined
    const rows = tb.data.rows.filter(
      (r) => !q || r.accountName.toLowerCase().includes(q) || r.subgroupName.toLowerCase().includes(q)
    )
    const totalDr = rows.reduce((s, r) => s + r.drPaise, 0)
    const totalCr = rows.reduce((s, r) => s + r.crPaise, 0)
    return deriveFinancials({ rows, totalDr, totalCr, balanced: totalDr === totalCr })
  })()

  return (
    <div>
      <PageBanner
        title={t('financials.title')}
        extra={
          <>
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <Segmented
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { value: 'income', label: t('financials.income') },
                { value: 'balance', label: t('financials.balance') },
                { value: 'summary', label: t('financials.summary') }
              ]}
            />
          </>
        }
      />
      {!f ? (
        <Card loading />
      ) : view === 'income' ? (
        <IncomeStatement f={f} />
      ) : view === 'balance' ? (
        <BalanceSheet f={f} />
      ) : (
        <Summary f={f} />
      )}
    </div>
  )
}

/** A sectioned two-column block: salmon header, unlabelled name/amount rows, a bold total row. */
function StatementSection({
  title,
  lines,
  totalLabel,
  totalPaise,
  side
}: {
  title: string
  lines: StatementLine[]
  totalLabel: string
  totalPaise: number
  side: Side
}): JSX.Element {
  return (
    <>
      <SectionBar>{title}</SectionBar>
      <Table
        className="pc-report"
        size="small"
        rowKey="name"
        showHeader={false}
        pagination={false}
        dataSource={lines}
        columns={[
          { dataIndex: 'name' },
          {
            dataIndex: 'paise',
            align: 'right' as const,
            width: 220,
            render: (v: number) => fmtSide(v, side)
          }
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>{totalLabel}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <strong>{fmtSide(totalPaise, side)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </>
  )
}

/**
 * A statement column grouped by subgroup: one salmon heading + subtotal per subgroup, then the
 * column's grand total as a dark result strip. Empty sections render nothing.
 */
function GroupedColumn({
  sections,
  totalLabel,
  totalPaise,
  side,
  labelFor
}: {
  sections: SubgroupSection[]
  totalLabel: string
  totalPaise: number
  side: Side
  labelFor?: (s: SubgroupSection) => { title: string; lines: StatementLine[] }
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      {sections.map((s) => {
        const mapped = labelFor?.(s) ?? { title: s.subgroup, lines: s.lines }
        return (
          <StatementSection
            key={s.subgroup}
            title={mapped.title}
            lines={mapped.lines}
            totalLabel={`${t('common.total')} ${mapped.title}`}
            totalPaise={s.totalPaise}
            side={side}
          />
        )
      })}
      <ResultLine label={totalLabel} paise={totalPaise} side={side} />
    </>
  )
}

/** The emphasised closing line (Net Profit / Total Liab + Equity), Rippling's dark result strip. */
function ResultLine({ label, paise, side }: { label: string; paise: number; side?: Side }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
        padding: '10px 16px',
        borderRadius: 8,
        background: '#4a0039',
        color: '#fff',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums'
      }}
    >
      <span>{label}</span>
      <span>{side ? fmtSide(paise, side) : formatINR(paise)}</span>
    </div>
  )
}

function IncomeStatement({ f }: { f: Financials }): JSX.Element {
  const { t } = useTranslation()
  const i = f.income
  const isLoss = i.netProfitPaise < 0
  return (
    <div style={{ maxWidth: 720 }}>
      <SectionBar>{t('financials.revenue')}</SectionBar>
      <GroupedColumn
        sections={i.revenue}
        totalLabel={t('financials.totalRevenue')}
        totalPaise={i.totalRevenuePaise}
        side="Cr"
      />
      <SectionBar>{t('financials.expenses')}</SectionBar>
      <GroupedColumn
        sections={i.expenses}
        totalLabel={t('financials.totalExpenses')}
        totalPaise={i.totalExpensesPaise}
        side="Dr"
      />
      <ResultLine
        label={isLoss ? t('financials.netLoss') : t('financials.netProfit')}
        paise={i.netProfitPaise}
        side="Cr"
      />
    </div>
  )
}

function BalanceSheet({ f }: { f: Financials }): JSX.Element {
  const { t } = useTranslation()
  const b = f.balance
  // Give the synthetic retained-earnings block/line a readable label.
  const equityLabel = (s: SubgroupSection): { title: string; lines: StatementLine[] } =>
    s.subgroup === '__retained__'
      ? {
          title: t('financials.retainedEarnings'),
          lines: s.lines.map((l) =>
            l.name === '__netProfit__' ? { name: t('financials.retainedEarnings'), paise: l.paise } : l
          )
        }
      : { title: s.subgroup, lines: s.lines }
  return (
    <div style={{ maxWidth: 720 }}>
      <SectionBar>{t('financials.assets')}</SectionBar>
      <GroupedColumn
        sections={b.assets}
        totalLabel={t('financials.totalAssets')}
        totalPaise={b.totalAssetsPaise}
        side="Dr"
      />
      <SectionBar>{t('financials.liabilities')}</SectionBar>
      <GroupedColumn
        sections={b.liabilities}
        totalLabel={t('financials.totalLiabilities')}
        totalPaise={b.totalLiabilitiesPaise}
        side="Cr"
      />
      <SectionBar>{t('financials.equity')}</SectionBar>
      <GroupedColumn
        sections={b.equity}
        totalLabel={t('financials.totalEquity')}
        totalPaise={b.totalEquityPaise}
        side="Cr"
        labelFor={equityLabel}
      />
      <ResultLine
        label={t('financials.liabilitiesPlusEquity')}
        paise={b.totalLiabilitiesPaise + b.totalEquityPaise}
        side="Cr"
      />
      <div style={{ marginTop: 12 }}>
        <StatusPill tone={b.balanced ? 'ok' : 'danger'}>
          {b.balanced ? t('financials.balanced') : t('financials.unbalanced')}
        </StatusPill>
      </div>
    </div>
  )
}

function Summary({ f }: { f: Financials }): JSX.Element {
  const { t } = useTranslation()
  const s = f.summary
  // Map account nature → the statement label already translated for the other views.
  const natureLabel: Record<SubgroupNature, string> = {
    asset: t('financials.assets'),
    liability: t('financials.liabilities'),
    capital: t('financials.equity'),
    income: t('financials.revenue'),
    expense: t('financials.expenses')
  }
  return (
    <div style={{ maxWidth: 720 }}>
      <SectionBar>{t('financials.categoryBreakdown')}</SectionBar>
      <Table
        className="pc-report"
        size="small"
        rowKey="nature"
        pagination={false}
        dataSource={s.byNature}
        columns={[
          {
            title: t('financials.category'),
            dataIndex: 'nature',
            render: (n: SubgroupNature) => natureLabel[n]
          },
          {
            title: t('common.dr'),
            dataIndex: 'drPaise',
            align: 'right' as const,
            width: 200,
            render: (v: number) => (v ? formatINR(v) : '')
          },
          {
            title: t('common.cr'),
            dataIndex: 'crPaise',
            align: 'right' as const,
            width: 200,
            render: (v: number) => (v ? formatINR(v) : '')
          }
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>{t('common.total')}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <strong>{formatINR(s.totalDrPaise)}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <strong>{formatINR(s.totalCrPaise)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      <div style={{ marginTop: 12 }}>
        <StatusPill tone={s.balanced ? 'ok' : 'danger'}>
          {s.balanced ? t('financials.balanced') : t('financials.unbalanced')}
        </StatusPill>
      </div>
    </div>
  )
}
