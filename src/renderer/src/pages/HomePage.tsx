import { Card, Col, Row, Spin, Statistic, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, BankOutlined, GoldOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import { useSession } from '../store/session'
import { formatINR } from '../lib/format'
import { palette } from '../theme'

const num = (n: number): string => n.toLocaleString('en-IN')

/** The cold's current status at a glance — stock, what's owed, what's been lent out, and cash.
 * All figures are read-only summaries composed from the existing services for the working year. */
export default function HomePage(): JSX.Element {
  const { t } = useTranslation()
  const session = useSession((s) => s.session)

  const stock = useQuery({
    queryKey: ['home', 'stock'],
    queryFn: async () => {
      const [aamad, nikasi] = await Promise.all([
        window.api.aamad.list(),
        window.api.nikasi.list()
      ])
      const out = nikasi.reduce((s, r) => s + r.totalPackets, 0)
      return {
        in: aamad.totalPackets,
        out,
        current: aamad.totalPackets - out
      }
    }
  })

  const party = useQuery({
    queryKey: ['home', 'party'],
    queryFn: async () => {
      const res = await window.api.party.search()
      let receivable = 0
      let payable = 0
      let standingBhada = 0
      let defaulters = 0
      let owingCount = 0
      for (const r of res.rows) {
        if (r.balancePaise > 0) {
          receivable += r.balancePaise
          owingCount += 1
        } else if (r.balancePaise < 0) payable += -r.balancePaise
        standingBhada += r.standingBhadaPaise
        if (r.isDefaulter) defaulters += 1
      }
      return { receivable, payable, standingBhada, defaulters, owingCount }
    }
  })

  const loans = useQuery({
    queryKey: ['home', 'loans'],
    queryFn: async () => {
      const rows = await window.api.loans.list()
      const active = rows.filter((r) => r.outstandingPaise > 0)
      return {
        outstanding: active.reduce((s, r) => s + r.outstandingPaise, 0),
        count: active.length
      }
    }
  })

  const cash = useQuery({
    queryKey: ['home', 'cash'],
    queryFn: async () => {
      const accounts = await window.api.moneybook.accounts()
      const summaries = await Promise.all(
        accounts.map((a) => window.api.moneybook.summary(a.id))
      )
      return {
        balance: summaries.reduce((s, m) => s + m.closingPaise, 0),
        count: accounts.length
      }
    }
  })

  const bardana = useQuery({
    queryKey: ['home', 'bardana'],
    queryFn: () => window.api.bardana.account()
  })

  const loading =
    stock.isLoading || party.isLoading || loans.isLoading || cash.isLoading || bardana.isLoading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ background: palette.primary, border: 'none' }}>
        <Typography.Title level={2} style={{ margin: 0, color: '#ffffff' }}>
          {t('home.title', { name: session?.accountantName })}
        </Typography.Title>
        <Typography.Text
          style={{
            fontSize: 13,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.82)',
            fontWeight: 600
          }}
        >
          {t('home.subtitle', { year: session?.year })}
        </Typography.Text>
      </Card>

      <div style={{ paddingInline: 4, paddingBottom: 8, borderBottom: `1px solid ${palette.outlineVariant}` }}>
        <Typography.Title level={4} style={{ margin: 0, color: palette.onSurface }}>
          {t('home.status')}
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            {t('home.asOf', { date: dayjs().format('DD/MM/YYYY') })}
          </Typography.Text>
        </Typography.Title>
      </div>

      {loading ? (
        <Card style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </Card>
      ) : (
        <>
          {/* Headline KPI cards — read-only summary figures. */}
          <Row gutter={[16, 16]}>
            <KpiCard
              icon={<GoldOutlined />}
              title={t('home.stock.title')}
              hint={t('home.stock.hint')}
              value={num(stock.data?.current ?? 0)}
              suffix={t('home.stock.unit')}
              sub={t('home.stock.sub', {
                in: num(stock.data?.in ?? 0),
                out: num(stock.data?.out ?? 0)
              })}
              accent={palette.primary}
            />
            <KpiCard
              icon={<ArrowDownOutlined />}
              title={t('home.owed.title')}
              hint={t('home.owed.hint')}
              value={formatINR(party.data?.receivable ?? 0)}
              sub={t('home.owed.sub', {
                n: num(party.data?.owingCount ?? 0),
                defaulters: num(party.data?.defaulters ?? 0)
              })}
              accent={palette.warning}
            />
            <KpiCard
              icon={<ArrowUpOutlined />}
              title={t('home.lent.title')}
              hint={t('home.lent.hint')}
              value={formatINR(loans.data?.outstanding ?? 0)}
              sub={t('home.lent.sub', { n: num(loans.data?.count ?? 0) })}
              accent={palette.info}
            />
            <KpiCard
              icon={<BankOutlined />}
              title={t('home.cash.title')}
              hint={t('home.cash.hint')}
              value={formatINR(cash.data?.balance ?? 0)}
              sub={t('home.cash.sub', { n: num(cash.data?.count ?? 0) })}
              accent={palette.success}
            />
          </Row>

          {/* Detail cards — read-only summary figures for the working year. */}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card title={t('home.movement.title')} style={{ height: '100%' }}>
                <DetailRow
                  label={t('home.movement.in')}
                  value={`${num(stock.data?.in ?? 0)} ${t('home.stock.unit')}`}
                />
                <DetailRow
                  label={t('home.movement.out')}
                  value={`${num(stock.data?.out ?? 0)} ${t('home.stock.unit')}`}
                />
                <DetailRow
                  label={t('home.movement.current')}
                  value={`${num(stock.data?.current ?? 0)} ${t('home.stock.unit')}`}
                  strong
                />
              </Card>
            </Col>

            <Col xs={24} md={8}>
              <Card title={t('home.money.title')} style={{ height: '100%' }}>
                <DetailRow
                  label={t('home.money.receivable')}
                  value={formatINR(party.data?.receivable ?? 0)}
                  color={palette.warning}
                />
                <DetailRow
                  label={t('home.money.payable')}
                  value={formatINR(party.data?.payable ?? 0)}
                  color={palette.error}
                />
                <DetailRow
                  label={t('home.money.rent')}
                  value={formatINR(party.data?.standingBhada ?? 0)}
                />
                <DetailRow
                  label={t('home.money.lent')}
                  value={formatINR(loans.data?.outstanding ?? 0)}
                />
              </Card>
            </Col>

            <Col xs={24} md={8}>
              <Card title={t('home.bardana.title')} style={{ height: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic title={t('home.bardana.stock')} value={num(bardana.data?.stockCount ?? 0)} />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title={t('home.bardana.profit')}
                      value={formatINR(bardana.data?.profitPaise ?? 0)}
                      valueStyle={{
                        color: (bardana.data?.profitPaise ?? 0) >= 0 ? palette.success : palette.error
                      }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  )
}

function KpiCard(props: {
  icon: ReactNode
  title: string
  hint: string
  value: string
  suffix?: string
  sub: string
  accent: string
}): JSX.Element {
  return (
    <Col xs={24} sm={12} xl={6}>
      <Card style={{ height: '100%' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              color: props.accent,
              background: `${props.accent}1f`
            }}
          >
            {props.icon}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: palette.onSurface
              }}
            >
              {props.title}
            </div>
            <div style={{ fontSize: 11, color: palette.onSurfaceVariant, marginBottom: 6 }}>
              {props.hint}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                lineHeight: 1.2,
                color: palette.onSurface,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {props.value}
              {props.suffix ? (
                <span style={{ fontSize: 14, fontWeight: 500, color: palette.onSurfaceVariant, marginLeft: 4 }}>
                  {props.suffix}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: palette.onSurfaceVariant, marginTop: 6 }}>
              {props.sub}
            </div>
          </div>
        </div>
      </Card>
    </Col>
  )
}

function DetailRow(props: {
  label: string
  value: string
  strong?: boolean
  color?: string
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderTop: `1px solid ${palette.surfaceContainer}`
      }}
    >
      <Typography.Text style={{ fontSize: 13, color: palette.onSurfaceVariant }}>
        {props.label}
      </Typography.Text>
      <Typography.Text
        style={{ fontWeight: props.strong ? 700 : 600, color: props.color ?? palette.onSurface, whiteSpace: 'nowrap' }}
      >
        {props.value}
      </Typography.Text>
    </div>
  )
}
