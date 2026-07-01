import { useEffect, useState } from 'react'
import { Drawer, Select, Space, Table, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { MoneyBookMonth } from '@shared/contracts'
import { formatDate, formatINR, MONTH_NAMES } from '../lib/format'
import { SeverityText } from '../components/Highlight'
import { useTableKeyNav } from '../lib/useTableKeyNav'

export default function MoneyBookPage(): JSX.Element {
  const { t } = useTranslation()
  const [accountId, setAccountId] = useState<number | undefined>()
  const [month, setMonth] = useState<number | null>(null)

  const accounts = useQuery({ queryKey: ['cashbanks'], queryFn: () => window.api.moneybook.accounts() })

  useEffect(() => {
    if (accountId === undefined && accounts.data && accounts.data.length > 0) {
      setAccountId(accounts.data[0].id)
    }
  }, [accounts.data, accountId])

  const summary = useQuery({
    queryKey: ['moneybook', accountId],
    queryFn: () => window.api.moneybook.summary(accountId!),
    enabled: accountId !== undefined
  })
  const detail = useQuery({
    queryKey: ['moneybook', accountId, month],
    queryFn: () => window.api.moneybook.detail(accountId!, month!),
    enabled: accountId !== undefined && month !== null
  })

  const monthData = summary.data?.months ?? []
  const { containerRef, rowClassName } = useTableKeyNav(
    monthData,
    (r) => setMonth(r.month)
  )

  const columns = [
    {
      title: t('moneyBook.month'),
      dataIndex: 'month',
      render: (m: number) => MONTH_NAMES[m - 1]
    },
    {
      title: t('moneyBook.opening'),
      dataIndex: 'openingPaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('moneyBook.receipts'),
      dataIndex: 'receiptsPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '—')
    },
    {
      title: t('moneyBook.payments'),
      dataIndex: 'paymentsPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '—')
    },
    {
      title: t('moneyBook.closing'),
      dataIndex: 'closingPaise',
      align: 'right' as const,
      // A cash/bank book that goes negative is overdrawn — a genuine red flag, so call it out.
      render: (v: number) =>
        v < 0 ? (
          <SeverityText severity="danger" strong>
            {formatINR(v)}
          </SeverityText>
        ) : (
          <strong>{formatINR(v)}</strong>
        )
    }
  ]

  const detailColumns = [
    { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
    { title: t('vouchers.no'), dataIndex: 'voucherNo', width: 60 },
    { title: t('moneyBook.counterparty'), dataIndex: 'counterparty' },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: t('moneyBook.receipts'),
      dataIndex: 'receiptPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('moneyBook.payments'),
      dataIndex: 'paymentPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '')
    }
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('moneyBook.title')}
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          placeholder={t('moneyBook.account')}
          value={accountId}
          onChange={(v) => setAccountId(v)}
          options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="month"
          size="small"
          loading={summary.isLoading}
          columns={columns}
          dataSource={monthData}
          pagination={false}
          rowClassName={rowClassName}
          onRow={(r: MoneyBookMonth) => ({
            onClick: () => setMonth(r.month),
            style: { cursor: 'pointer' }
          })}
        />
      </div>

      <Drawer
        title={month ? `${MONTH_NAMES[month - 1]} — ${t('moneyBook.title')}` : ''}
        open={month !== null}
        onClose={() => setMonth(null)}
        width={680}
      >
        <Table
          rowKey="voucherId"
          size="small"
          loading={detail.isLoading}
          columns={detailColumns}
          dataSource={detail.data ?? []}
          pagination={false}
        />
      </Drawer>
    </div>
  )
}
