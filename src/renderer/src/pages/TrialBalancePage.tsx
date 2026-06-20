import { Space, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TrialBalanceRow } from '@shared/contracts'
import { formatINR } from '../lib/format'

export default function TrialBalancePage(): JSX.Element {
  const { t } = useTranslation()
  const tb = useQuery({ queryKey: ['trialBalance'], queryFn: () => window.api.ledger.trialBalance() })

  const columns = [
    { title: t('trialBalance.account'), dataIndex: 'accountName' },
    { title: t('accounts.subgroup'), dataIndex: 'subgroupName' },
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
      <Space style={{ marginBottom: 16 }} align="center">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('trialBalance.title')}
        </Typography.Title>
        {tb.data &&
          (tb.data.balanced ? (
            <Tag color="green">{t('trialBalance.balanced')}</Tag>
          ) : (
            <Tag color="red">{t('trialBalance.unbalanced')}</Tag>
          ))}
      </Space>
      <Table
        rowKey="accountId"
        size="small"
        loading={tb.isLoading}
        columns={columns}
        dataSource={tb.data?.rows ?? []}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2} align="right">
              <strong>{t('common.total')}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <strong>{formatINR(tb.data?.totalDr ?? 0)}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong>{formatINR(tb.data?.totalCr ?? 0)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </div>
  )
}
