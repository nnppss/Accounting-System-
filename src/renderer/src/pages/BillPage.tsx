import { Button, Card, Descriptions, Divider, Empty, Space, Statistic, Table, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { BillLoanLine, BillSection, LedgerLine } from '@shared/contracts'
import { formatDate, formatINR } from '../lib/format'
import { BalanceAmount, BalanceSentence } from '../components/Highlight'
import { usePrinter } from '../lib/usePrinter'

/** A single person's bill (software.md §3.11): a section per role + a combined net. Print-ready. */
export default function BillPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const print = usePrinter()
  const { accountId } = useParams()
  const id = Number(accountId)
  // Keep the originating section (e.g. Party) highlighted: back returns there, and opening a
  // ledger from here forwards the same origin so the dashboard never switches mid-flow.
  const location = useLocation()
  const fromNav = (location.state as { fromNav?: string } | null)?.fromNav
  const backTarget = fromNav ?? '/bills'

  const bill = useQuery({ queryKey: ['bill', id], queryFn: () => window.api.bills.get(id) })
  const data = bill.data

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTarget)} />
        <Typography.Title level={3} style={{ margin: 0 }}>
          {data?.name ?? `#${id}`}
        </Typography.Title>
        {data && (
          <Button
            icon={<PrinterOutlined />}
            onClick={() => print(() => window.api.print.bill(id, data.asOf))}
          >
            {t('common.print')}
          </Button>
        )}
      </Space>

      {!data ? (
        <Empty />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
              <Descriptions size="small" column={1} style={{ maxWidth: 360 }}>
                {data.sonOf && <Descriptions.Item label={t('bills.sonOf')}>{data.sonOf}</Descriptions.Item>}
                {data.villageCity && (
                  <Descriptions.Item label={t('bills.village')}>{data.villageCity}</Descriptions.Item>
                )}
                {data.phone && <Descriptions.Item label={t('bills.phone')}>{data.phone}</Descriptions.Item>}
                <Descriptions.Item label={t('bills.asOf')}>{data.asOf}</Descriptions.Item>
              </Descriptions>
              <Statistic
                title={t('bills.combinedNet')}
                value={data.combinedNetPaise}
                formatter={() => <BalanceAmount paise={data.combinedNetPaise} strong />}
              />
            </Space>
            <div style={{ marginTop: 12 }}>
              <BalanceSentence name={data.name} paise={data.combinedNetPaise} />
            </div>
          </Card>

          {data.sections.map((s) => (
            <SectionCard
              key={s.accountId}
              section={s}
              onLedger={() =>
                navigate(`/accounts/${s.accountId}`, fromNav ? { state: { fromNav } } : undefined)
              }
            />
          ))}
        </>
      )}
    </div>
  )
}

function SectionCard({
  section,
  onLedger
}: {
  section: BillSection
  onLedger: () => void
}): JSX.Element {
  const { t } = useTranslation()

  const ledgerCols = [
    { title: t('common.date'), dataIndex: 'date', width: 100, render: (v: string) => formatDate(v) },
    {
      title: t('vouchers.type'),
      key: 'v',
      width: 120,
      render: (_: unknown, r: LedgerLine) => `${t(`vouchers.${r.type}`)} #${r.voucherNo}`
    },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: t('common.dr'),
      dataIndex: 'drPaise',
      align: 'right' as const,
      width: 120,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.cr'),
      dataIndex: 'crPaise',
      align: 'right' as const,
      width: 120,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => <BalanceAmount paise={v} />
    }
  ]

  const loanCols = [
    { title: t('common.date'), dataIndex: 'date', width: 100, render: (v: string) => formatDate(v) },
    {
      title: t('loans.category'),
      dataIndex: 'category',
      render: (c: BillLoanLine['category']) => t(`loans.cat.${c}`)
    },
    {
      title: t('loans.nature'),
      dataIndex: 'nature',
      render: (n: BillLoanLine['nature']) => t(`loans.nature.${n}`)
    },
    {
      title: t('bills.unpostedInterest'),
      dataIndex: 'unpostedInterestPaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('loans.outstanding'),
      dataIndex: 'liveOutstandingPaise',
      align: 'right' as const,
      render: (v: number) => <strong>{formatINR(v)}</strong>
    }
  ]

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <Tag color="blue">{t(`accounts.type.${section.role}`)}</Tag>
          <span>{section.accountName}</span>
          <Typography.Text type="secondary" style={{ fontWeight: 'normal' }}>
            {section.subgroupName}
          </Typography.Text>
        </Space>
      }
      extra={
        <Space>
          {section.standingBhadaPaise !== 0 && (
            <Typography.Text type="secondary">
              {t('bills.standingBhada')}: {formatINR(section.standingBhadaPaise)}
            </Typography.Text>
          )}
          <Button size="small" onClick={onLedger}>
            {t('accounts.ledger')}
          </Button>
        </Space>
      }
    >
      {section.ledgerLines.length === 0 ? (
        <Typography.Text type="secondary">{t('bills.noLedger')}</Typography.Text>
      ) : (
        <Table
          rowKey="voucherId"
          size="small"
          columns={ledgerCols}
          dataSource={section.ledgerLines}
          pagination={false}
        />
      )}

      {section.loans.length > 0 && (
        <>
          <Divider orientation="left" style={{ marginBottom: 8 }}>
            {t('nav.loans')}
          </Divider>
          <Table rowKey="loanId" size="small" columns={loanCols} dataSource={section.loans} pagination={false} />
        </>
      )}

      {(section.bardanaRows.length > 0 || section.expenseRows.length > 0) && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {section.bardanaRows.length > 0 && (
            <span>
              {t('bills.bardanaDealings', { count: section.bardanaRows.length })}{' '}
            </span>
          )}
          {section.expenseRows.length > 0 && (
            <span>{t('bills.expensePayments', { count: section.expenseRows.length })}</span>
          )}
        </Typography.Paragraph>
      )}

      <Divider style={{ margin: '12px 0' }} />
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Typography.Text strong>{t('bills.sectionNet')}:</Typography.Text>
        <BalanceAmount paise={section.netPaise} strong />
      </Space>
    </Card>
  )
}
