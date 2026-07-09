import { useState } from 'react'
import { Button, Input, Table } from 'antd'
import { PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TrialBalanceRow } from '@shared/contracts'
import { formatINR } from '../lib/format'
import { groupBySubgroup } from '@shared/financials'
import { usePrinter } from '../lib/usePrinter'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner, SectionBar, StatusPill } from '../components/report'

export default function TrialBalancePage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const print = usePrinter()
  const [search, setSearch] = useState('')
  const tb = useQuery({ queryKey: ['trialBalance'], queryFn: () => window.api.ledger.trialBalance() })

  const q = search.trim().toLowerCase()
  const rows = (tb.data?.rows ?? []).filter(
    (r) => !q || r.accountName.toLowerCase().includes(q) || r.subgroupName.toLowerCase().includes(q)
  )
  const groups = groupBySubgroup(rows)
  // Keyboard row-selection spans the per-subgroup tables. groupBySubgroup re-sorts, so the
  // hook must see the rows in rendered (grouped) order; the global index then maps onto
  // per-group indices via an offset.
  const openLedger = (r: TrialBalanceRow): void =>
    navigate(`/accounts/${r.accountId}`, { state: { fromNav: '/trial-balance' } })
  const { activeIndex, containerRef } = useTableKeyNav(
    groups.flatMap((g) => g.rows),
    openLedger
  )
  const groupOffsets: number[] = []
  groups.reduce((off, g) => {
    groupOffsets.push(off)
    return off + g.rows.length
  }, 0)
  // Grand totals reflect what's shown (equal the book totals when no search is active).
  const totalDr = rows.reduce((s, r) => s + r.drPaise, 0)
  const totalCr = rows.reduce((s, r) => s + r.crPaise, 0)

  const columns = [
    {
      title: t('trialBalance.account'),
      dataIndex: 'accountName',
      render: (v: string, r: TrialBalanceRow) => (
        <span>
          {v}
          {r.sonOf ? <span style={{ color: '#8c8c8c' }}> · s/o {r.sonOf}</span> : null}
        </span>
      )
    },
    {
      title: t('common.dr'),
      dataIndex: 'drPaise',
      align: 'right' as const,
      width: 160,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.cr'),
      dataIndex: 'crPaise',
      align: 'right' as const,
      width: 160,
      render: (v: number) => (v ? formatINR(v) : '')
    }
  ]

  return (
    <div>
      <PageBanner
        title={t('trialBalance.title')}
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
            {tb.data && (
              <StatusPill tone={tb.data.balanced ? 'ok' : 'danger'}>
                {tb.data.balanced ? t('trialBalance.balanced') : t('trialBalance.unbalanced')}
              </StatusPill>
            )}
            <Button
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => print(() => window.api.print.trialBalance())}
            >
              {t('common.print')}
            </Button>
          </>
        }
      />
      <div ref={containerRef}>
      {groups.map((g, i) => {
        const subDr = g.rows.reduce((s, r) => s + r.drPaise, 0)
        const subCr = g.rows.reduce((s, r) => s + r.crPaise, 0)
        return (
          <div key={g.subgroup}>
            <SectionBar>{g.subgroup}</SectionBar>
            <Table
              className="pc-report"
              rowKey="accountId"
              size="small"
              loading={tb.isLoading}
              showHeader={i === 0}
              columns={columns}
              dataSource={g.rows}
              pagination={false}
              rowClassName={(_, ri) => (groupOffsets[i] + ri === activeIndex ? 'pc-row-active' : '')}
              onRow={(r: TrialBalanceRow) => ({
                onClick: () => openLedger(r),
                style: { cursor: 'pointer' }
              })}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} align="right">
                    <strong>{`${t('common.total')} ${g.subgroup}`}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{subDr ? formatINR(subDr) : ''}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <strong>{subCr ? formatINR(subCr) : ''}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>
        )
      })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 24,
          marginTop: 16,
          padding: '10px 16px',
          borderRadius: 8,
          background: '#4a0039',
          color: '#fff',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        <span style={{ marginRight: 'auto' }}>{t('common.total')}</span>
        <span>
          {t('common.dr')} {formatINR(totalDr)}
        </span>
        <span>
          {t('common.cr')} {formatINR(totalCr)}
        </span>
      </div>
    </div>
  )
}
