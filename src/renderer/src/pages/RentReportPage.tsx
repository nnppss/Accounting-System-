import { Card, Input, Table } from 'antd'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { RentReportKisan } from '@shared/contracts'
import { formatDate, formatINR } from '../lib/format'
import { PageBanner, SectionBar } from '../components/report'

/**
 * Rent report — the year's storage rent at a glance: what the cold should earn (billed), what it has
 * collected, what is still due, plus a per-kisan table. Expanding a kisan lists every rent payment
 * (turn) he has made. All figures come from getRentReport (rent-tagged ledger entries).
 */
export default function RentReportPage(): JSX.Element {
  const { t } = useTranslation()
  const report = useQuery({ queryKey: ['rentReport'], queryFn: () => window.api.bhada.report() })
  const r = report.data
  const [search, setSearch] = useState('')

  const kisans = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return r?.kisans ?? []
    return (r?.kisans ?? []).filter((k) => k.name.toLowerCase().includes(q))
  }, [r?.kisans, search])

  const tile = (label: string, paise: number): JSX.Element => (
    <Card size="small" style={{ flex: 1, minWidth: 200 }}>
      <div style={{ color: 'var(--muted, #888)', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(paise)}
      </div>
    </Card>
  )

  const columns = [
    { title: t('rent.kisan'), dataIndex: 'name' },
    {
      title: t('rent.billed'),
      dataIndex: 'billedPaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('rent.paid'),
      dataIndex: 'paidPaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('rent.due'),
      dataIndex: 'duePaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    }
  ]

  return (
    <div>
      <PageBanner title={t('rent.title')} />

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {tile(t('rent.totalBilled'), r?.totalBilledPaise ?? 0)}
        {tile(t('rent.totalCollected'), r?.totalCollectedPaise ?? 0)}
        {tile(t('rent.totalDue'), r?.totalDuePaise ?? 0)}
      </div>

      <SectionBar>{t('rent.perKisan')}</SectionBar>
      <Input.Search
        placeholder={t('rent.search')}
        allowClear
        value={search}
        style={{ width: 320, marginBottom: 16 }}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Table
        className="pc-report"
        rowKey="accountId"
        loading={report.isLoading}
        dataSource={kisans}
        columns={columns}
        pagination={false}
        expandable={{
          rowExpandable: (k: RentReportKisan) => k.payments.length > 0,
          expandedRowRender: (k: RentReportKisan) => (
            <Table
              size="small"
              rowKey="voucherNo"
              pagination={false}
              dataSource={k.payments}
              columns={[
                { title: t('common.date'), dataIndex: 'date', render: (v: string) => formatDate(v) },
                { title: t('rent.receiptNo'), dataIndex: 'voucherNo', render: (n: number) => `#${n}` },
                {
                  title: t('rent.paid'),
                  dataIndex: 'amountPaise',
                  align: 'right' as const,
                  render: (v: number) => formatINR(v)
                }
              ]}
            />
          )
        }}
      />
    </div>
  )
}
