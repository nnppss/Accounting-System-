import { useState, type ReactNode } from 'react'
import { Button, Card, Col, Descriptions, Empty, Row, Space, Statistic, Table, Typography } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AccountOverview as Overview, NikasiListFilter } from '@shared/contracts'
import { formatDate, formatINR } from '../lib/format'
import { BalanceAmount } from './Highlight'
import { SectionBar } from './report'

type Drill = 'aamad' | 'nikasiOut' | 'purchased' | 'loan' | null

/**
 * 360° Overview tab for an opened party account: clickable stock/money tiles that drill into the
 * underlying records in full legacy detail (aamad lines, per-kisan gate-pass register, loans).
 * Money tiles jump to the Ledger tab, which already shows the signed running balance.
 */
export function AccountOverview({
  accountId,
  onShowLedger
}: {
  accountId: number
  onShowLedger: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [drill, setDrill] = useState<Drill>(null)

  const overview = useQuery({
    queryKey: ['overview', accountId],
    queryFn: () => window.api.accounts.overview(accountId)
  })
  const o: Overview | undefined = overview.data

  if (!o) return <Card loading />

  const s = o.stock
  const m = o.money

  return (
    <div>
      {(s.aamadPackets > 0 || s.nikasiOutPackets > 0 || s.purchasedPackets > 0) && (
        <>
        <SectionBar>{t('overview.stockSection')}</SectionBar>
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {s.aamadPackets > 0 && (
            <Tile
              label={t('overview.aamadIn')}
              value={s.aamadPackets}
              sub={t('overview.aamadCount', { count: s.aamadCount })}
              onClick={() => setDrill('aamad')}
            />
          )}
          {s.nikasiOutPackets > 0 && (
            <Tile
              label={t('overview.nikasiOut')}
              value={s.nikasiOutPackets}
              onClick={() => setDrill('nikasiOut')}
            />
          )}
          {s.aamadPackets > 0 && (
            <Tile label={t('overview.stockBalance')} value={s.balancePackets} />
          )}
          {s.purchasedPackets > 0 && (
            <Tile
              label={t('overview.purchased')}
              value={s.purchasedPackets}
              onClick={() => setDrill('purchased')}
            />
          )}
        </Row>
        </>
      )}

      <SectionBar>{t('overview.moneySection')}</SectionBar>
      <Row gutter={[12, 12]}>
        {m.openingPaise !== 0 && (
          <MoneyTile label={t('overview.opening')} paise={m.openingPaise} onClick={onShowLedger} />
        )}
        {m.rentPaise !== 0 && (
          <MoneyTile label={t('overview.rent')} paise={m.rentPaise} onClick={onShowLedger} />
        )}
        {m.loanPaise !== 0 && (
          <MoneyTile label={t('overview.loan')} paise={m.loanPaise} onClick={() => setDrill('loan')} />
        )}
        {m.interestPaise !== 0 && (
          <MoneyTile label={t('overview.interest')} paise={m.interestPaise} onClick={onShowLedger} />
        )}
        {m.tradePaise !== 0 && (
          <MoneyTile label={t('overview.trade')} paise={m.tradePaise} onClick={onShowLedger} />
        )}
        {m.otherPaise !== 0 && (
          <MoneyTile label={t('overview.other')} paise={m.otherPaise} onClick={onShowLedger} />
        )}
        <MoneyTile label={t('common.balance')} paise={m.balancePaise} onClick={onShowLedger} strong />
        {m.newBalancePaise !== m.balancePaise && (
          <MoneyTile
            label={t('overview.newBalance')}
            paise={m.newBalancePaise}
            onClick={onShowLedger}
            strong
          />
        )}
      </Row>

      {/* Drill-down renders inline below the tiles (no modal) so the detail sits in the page flow. */}
      {drill && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            padding: 16
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12
            }}
          >
            <Typography.Title level={5} style={{ margin: 0 }}>
              {t(`overview.drill.${drill}`)}
            </Typography.Title>
            <Button type="text" icon={<CloseOutlined />} onClick={() => setDrill(null)} />
          </div>
          {drill === 'aamad' && <AamadDrill accountId={accountId} rentRatePaise={o.rentRatePaise} />}
          {drill === 'nikasiOut' && (
            <NikasiDrill filter={{ fromKisanAccountId: accountId }} rentRatePaise={o.rentRatePaise} />
          )}
          {drill === 'purchased' && (
            <NikasiDrill filter={{ deliveredToAccountId: accountId }} rentRatePaise={o.rentRatePaise} />
          )}
          {drill === 'loan' && <LoanDrill accountId={accountId} />}
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  onClick
}: {
  label: string
  value: number
  sub?: ReactNode
  onClick?: () => void
}): JSX.Element {
  return (
    <Col xs={12} sm={8} md={6}>
      <Card
        size="small"
        hoverable={!!onClick}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        <Statistic title={label} value={value} />
        {sub && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {sub}
          </Typography.Text>
        )}
      </Card>
    </Col>
  )
}

function MoneyTile({
  label,
  paise,
  onClick,
  strong
}: {
  label: string
  paise: number
  onClick?: () => void
  strong?: boolean
}): JSX.Element {
  return (
    <Col xs={12} sm={8} md={6}>
      <Card
        size="small"
        hoverable={!!onClick}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        <Statistic
          title={label}
          formatter={() => <BalanceAmount paise={paise} strong={strong} />}
        />
      </Card>
    </Col>
  )
}

function AamadDrill({
  accountId,
  rentRatePaise
}: {
  accountId: number
  rentRatePaise: number
}): JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const q = useQuery({
    queryKey: ['overview-aamad', accountId],
    queryFn: () => window.api.aamad.list({ kisanAccountId: accountId })
  })
  const rows = q.data?.rows ?? []
  const totalPkts = rows.reduce((s, r) => s + r.totalPackets, 0)
  return (
    <Table
      rowKey="id"
      size="small"
      loading={q.isLoading}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: <Empty /> }}
      columns={[
        { title: t('overview.lotNo'), dataIndex: 'no', width: 100 },
        { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
        { title: t('aamad.totalPackets'), dataIndex: 'totalPackets', align: 'right' as const },
        {
          title: t('overview.rent'),
          key: 'rent',
          align: 'right' as const,
          render: (_: unknown, r) => formatINR(r.totalPackets * rentRatePaise)
        }
      ]}
      expandable={{
        // Default every lot open so its rack breakdown is visible without a click; the user can
        // still collapse one. (Controlled keys because defaultExpandAllRows misses async-loaded rows.)
        expandedRowKeys: rows.filter((r) => !collapsed.has(r.id)).map((r) => r.id),
        onExpand: (open, r) =>
          setCollapsed((prev) => {
            const next = new Set(prev)
            open ? next.delete(r.id) : next.add(r.id)
            return next
          }),
        expandedRowRender: (r) => <AamadLocations aamadId={r.id} />
      }}
      summary={() =>
        rows.length ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2} align="right">
              <strong>{t('overview.summary', { lots: rows.length })}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <strong>{totalPkts}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong>{formatINR(totalPkts * rentRatePaise)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        ) : null
      }
    />
  )
}

function AamadLocations({ aamadId }: { aamadId: number }): JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['overview-aamad-detail', aamadId],
    queryFn: () => window.api.aamad.get(aamadId)
  })
  return (
    <Table
      rowKey="id"
      size="small"
      loading={q.isLoading}
      pagination={false}
      dataSource={q.data?.locations ?? []}
      columns={[
        {
          title: t('maps.rack'),
          key: 'loc',
          render: (_: unknown, l) => `R${l.room}/F${l.floor}/${l.rack}`
        },
        { title: t('aamad.packets'), dataIndex: 'packets', align: 'right' as const }
      ]}
    />
  )
}

function NikasiDrill({
  filter,
  rentRatePaise
}: {
  filter: NikasiListFilter
  rentRatePaise: number
}): JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['overview-nikasi', filter],
    queryFn: () => window.api.nikasi.list(filter)
  })
  const rows = q.data ?? []
  const totalPkts = rows.reduce((s, r) => s + r.totalPackets, 0)
  const totalRent = rows.reduce((s, r) => s + r.totalPackets * rentRatePaise, 0)
  const totalAmount = rows.reduce((s, r) => s + r.totalAmountPaise, 0)

  if (q.isLoading) return <Table size="small" loading pagination={false} dataSource={[]} columns={[]} />
  if (rows.length === 0) return <Empty />

  // One clean card per gate pass: a summary header (delivered-to / vehicle / packets / rent /
  // amount) over the per-kisan register — no nested tables, nothing hidden behind an expander.
  return (
    <div>
      {rows.map((r) => (
        <Card
          key={r.id}
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <Space size="small">
              <span>
                {t('nikasi.billNo')} #{r.billNo}
              </span>
              <Typography.Text type="secondary">· {formatDate(r.date)}</Typography.Text>
            </Space>
          }
          extra={<strong>{formatINR(r.totalAmountPaise)}</strong>}
        >
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} style={{ marginBottom: 4 }}>
            <Descriptions.Item label={t('nikasi.deliveredTo')}>
              {r.deliveredToName} ({t(`delivery.${r.deliveredToType}`)})
            </Descriptions.Item>
            <Descriptions.Item label={t('nikasi.vehicle')}>{r.vehicleNo ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('nikasi.packetsCol')}>{r.totalPackets}</Descriptions.Item>
            <Descriptions.Item label={t('overview.rent')}>
              {formatINR(r.totalPackets * rentRatePaise)}
            </Descriptions.Item>
          </Descriptions>
          <NikasiRegister nikasiId={r.id} />
        </Card>
      ))}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          padding: '10px 12px',
          borderTop: '1px solid #f0f0f0',
          fontWeight: 600
        }}
      >
        <span>{t('overview.summaryNikasi', { count: rows.length })}</span>
        <Space size="large" wrap>
          <span>
            {totalPkts} {t('nikasi.packetsCol')}
          </span>
          <span>
            {t('overview.rent')}: {formatINR(totalRent)}
          </span>
          <span>{formatINR(totalAmount)}</span>
        </Space>
      </div>
    </div>
  )
}

/** The full legacy per-kisan register for one gate pass (matches the printed Vyapari ledger). */
function NikasiRegister({ nikasiId }: { nikasiId: number }): JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['overview-nikasi-detail', nikasiId],
    queryFn: () => window.api.nikasi.get(nikasiId)
  })
  const d = q.data
  if (!d) return <Table size="small" loading pagination={false} dataSource={[]} columns={[]} />
  return (
      <Table
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        dataSource={d.lines}
        columns={[
          { title: t('aamad.lot'), dataIndex: 'lotNo' },
          { title: t('nikasi.fromKisan'), dataIndex: 'fromKisanName' },
          { title: t('nikasi.packets'), dataIndex: 'packets', align: 'right' as const },
          {
            title: t('nikasi.weight'),
            dataIndex: 'weightKg',
            align: 'right' as const,
            render: (v: number | null) => (v == null ? '—' : v)
          },
          {
            title: t('overview.avgPerPacket'),
            key: 'avg',
            align: 'right' as const,
            render: (_: unknown, l) =>
              l.weightKg == null || l.packets === 0 ? '—' : (l.weightKg / l.packets).toFixed(2)
          },
          {
            title: t('nikasi.rate'),
            dataIndex: 'ratePaise',
            align: 'right' as const,
            render: (v: number) => formatINR(v)
          },
          {
            title: t('nikasi.amount'),
            dataIndex: 'amountPaise',
            align: 'right' as const,
            render: (v: number) => formatINR(v)
          }
        ]}
      />
  )
}

function LoanDrill({ accountId }: { accountId: number }): JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['overview-loans', accountId],
    queryFn: () => window.api.loans.list()
  })
  const rows = (q.data ?? []).filter((l) => l.accountId === accountId)
  return (
    <Table
      rowKey="id"
      size="small"
      loading={q.isLoading}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: <Empty /> }}
      columns={[
        { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
        { title: t('loans.nature'), dataIndex: 'nature', render: (n: string) => t(`loans.nature.${n}`) },
        {
          title: t('loans.principal'),
          dataIndex: 'principalPaise',
          align: 'right' as const,
          render: (v: number) => formatINR(v)
        },
        {
          title: t('loans.outstanding'),
          dataIndex: 'outstandingPaise',
          align: 'right' as const,
          render: (v: number) => <strong>{formatINR(v)}</strong>
        }
      ]}
    />
  )
}
