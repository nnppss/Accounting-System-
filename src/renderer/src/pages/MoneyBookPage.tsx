import { useEffect, useState } from 'react'
import { Button, Segmented, Select, Space, Table, Typography } from 'antd'
import { ArrowLeftOutlined, FileExcelOutlined, PrinterOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { MoneyBookDetailRow, MoneyBookMonth } from '@shared/contracts'
import { formatDate, formatINR, MONTH_NAMES, paiseToRupees } from '../lib/format'
import { SeverityText } from '../components/Highlight'
import { PageBanner } from '../components/report'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { DayBookView } from '../components/DayBookView'

type View = 'monthly' | 'day'

export default function MoneyBookPage(): JSX.Element {
  const { t } = useTranslation()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const navigate = useNavigate()
  // In the URL, so a page opened from here (a party's ledger) comes back to the segment it left.
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'day' ? 'day' : 'monthly'
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
  const accountName = (accounts.data ?? []).find((a) => a.id === accountId)?.name ?? ''
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
    { title: t('common.date'), dataIndex: 'date', width: 100, render: (v: string) => formatDate(v) },
    { title: t('vouchers.no'), dataIndex: 'voucherNo', width: 50 },
    {
      title: t('moneyBook.counterparty'),
      dataIndex: 'counterparties',
      width: 150,
      render: (cs: MoneyBookDetailRow['counterparties']) => cs.map((c) => c.name).join(', ')
    },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: t('moneyBook.receipts'),
      dataIndex: 'receiptPaise',
      align: 'right' as const,
      width: 110,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('moneyBook.payments'),
      dataIndex: 'paymentPaise',
      align: 'right' as const,
      width: 110,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      width: 120,
      // Cash holding after this transaction. Negative = overdrawn, a red flag.
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

  return (
    <div>
      <PageBanner
        title={t('moneyBook.title')}
        extra={
          <>
            <Segmented
              value={view}
              onChange={(v) => setParams({ view: v as View }, { replace: true })}
              options={[
                { value: 'monthly', label: t('moneyBook.monthly') },
                { value: 'day', label: t('dayBook.title') }
              ]}
            />
            {view === 'monthly' && (
              <Select
                style={{ width: 240 }}
                placeholder={t('moneyBook.account')}
                value={accountId}
                onChange={(v) => setAccountId(v)}
                options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              />
            )}
            {view === 'monthly' && accountId !== undefined && (
              <>
                {/* Opening balances for Cash/bank are set on the account's own page (at software
                    adoption these carry the real starting balances). */}
                <Button
                  onClick={() =>
                    navigate(`/accounts/${accountId}`, { state: { fromNav: '/money-book' } })
                  }
                >
                  {t('accounts.openingBalance')}
                </Button>
                <Button
                  icon={<PrinterOutlined />}
                  onClick={() => print(() => window.api.print.moneyBookSummary(accountId))}
                >
                  {t('common.print')}
                </Button>
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={() =>
                    exportXlsx(
                      'money-book.xlsx',
                      accountName || t('moneyBook.title'),
                      [
                        t('moneyBook.month'),
                        t('moneyBook.opening'),
                        t('moneyBook.receipts'),
                        t('moneyBook.payments'),
                        t('moneyBook.closing')
                      ],
                      monthData.map((m) => [
                        MONTH_NAMES[m.month - 1],
                        paiseToRupees(m.openingPaise),
                        paiseToRupees(m.receiptsPaise),
                        paiseToRupees(m.paymentsPaise),
                        paiseToRupees(m.closingPaise)
                      ]),
                      [1, 2, 3, 4] // Opening, Receipts, Payments, Closing
                    )
                  }
                >
                  {t('common.excel')}
                </Button>
              </>
            )}
          </>
        }
      />

      {view === 'day' ? (
        <DayBookView />
      ) : month !== null ? (
        // The month's transactions take over where the list was — same width, same table, Back to
        // the months. (Was a drawer; a full-width table beats a 820px panel over the thing it came
        // from, and there is nothing on the list worth keeping in view behind it.)
        <>
          <Space style={{ marginBottom: 16 }}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => setMonth(null)}>
              {t('common.back')}
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {MONTH_NAMES[month - 1]}
            </Typography.Title>
            {accountId !== undefined && (
              <Button
                icon={<PrinterOutlined />}
                onClick={() => print(() => window.api.print.moneyBookDetail(accountId, month))}
              >
                {t('common.print')}
              </Button>
            )}
            {accountId !== undefined && (
              <Button
                icon={<FileExcelOutlined />}
                onClick={() =>
                  exportXlsx(
                    `money-book-${MONTH_NAMES[month - 1]}.xlsx`,
                    `${accountName} — ${MONTH_NAMES[month - 1]}`,
                    [
                      t('common.date'),
                      t('vouchers.no'),
                      t('moneyBook.counterparty'),
                      t('common.narration'),
                      t('moneyBook.receipts'),
                      t('moneyBook.payments'),
                      t('common.balance')
                    ],
                    (detail.data ?? []).map((r) => [
                      formatDate(r.date),
                      r.voucherNo,
                      r.counterparties.map((c) => c.name).join(', '),
                      r.narration ?? '',
                      r.receiptPaise ? paiseToRupees(r.receiptPaise) : '',
                      r.paymentPaise ? paiseToRupees(r.paymentPaise) : '',
                      paiseToRupees(r.balancePaise)
                    ]),
                    [4, 5, 6] // Receipts, Payments, Balance
                  )
                }
              >
                {t('common.excel')}
              </Button>
            )}
          </Space>
          <Table
            className="pc-report"
            rowKey="voucherId"
            size="small"
            loading={detail.isLoading}
            columns={detailColumns}
            dataSource={detail.data ?? []}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </>
      ) : (
        <div ref={containerRef}>
          <Table
            className="pc-report"
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
      )}
    </div>
  )
}
