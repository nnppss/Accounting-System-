import { Button, Space, Table, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LedgerLine } from '@shared/contracts'
import { balanceLabel, formatINR } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'

export default function AccountLedgerPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const print = usePrinter()
  const { id } = useParams()
  const accountId = Number(id)

  const ledger = useQuery({
    queryKey: ['ledger', accountId],
    queryFn: () => window.api.accounts.ledger(accountId)
  })
  const accounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => window.api.accounts.list({ includeSystem: true })
  })
  const account = (accounts.data ?? []).find((a) => a.id === accountId)

  const columns = [
    { title: t('common.date'), dataIndex: 'date', width: 110 },
    {
      title: t('vouchers.type'),
      key: 'voucher',
      width: 120,
      render: (_: unknown, r: LedgerLine) => `${t(`vouchers.${r.type}`)} #${r.voucherNo}`
    },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: 'Tag',
      dataIndex: 'tag',
      width: 90,
      render: (tag: string) => (tag === 'general' ? '' : <Tag>{tag}</Tag>)
    },
    {
      title: t('common.dr'),
      dataIndex: 'drPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.cr'),
      dataIndex: 'crPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      width: 150,
      render: (v: number) => balanceLabel(v)
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounts')} />
        <Typography.Title level={3} style={{ margin: 0 }}>
          {account?.name ?? `#${accountId}`}
        </Typography.Title>
        {account && <Tag>{t(`accounts.type.${account.type}`)}</Tag>}
        <Button
          size="small"
          icon={<PrinterOutlined />}
          onClick={() => print(() => window.api.print.ledger(accountId))}
        >
          {t('common.print')}
        </Button>
      </Space>
      <Table
        rowKey="voucherId"
        size="small"
        loading={ledger.isLoading}
        columns={columns}
        dataSource={ledger.data ?? []}
        pagination={false}
        summary={(rows) => {
          const last = rows[rows.length - 1] as LedgerLine | undefined
          return last ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align="right">
                <strong>{t('common.balance')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <strong>{balanceLabel(last.balancePaise)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }}
      />
    </div>
  )
}
