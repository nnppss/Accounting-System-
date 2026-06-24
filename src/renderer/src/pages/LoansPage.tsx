import { useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { Bill, LoanRow } from '@shared/contracts'
import type { LoanCategory, LoanEventType, LoanMode, LoanNature } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'
import AccountSearchSelect from '../components/AccountSearchSelect'

const CATEGORY_TYPE: Record<LoanCategory, 'kisan' | 'vyapari' | null> = {
  kisan: 'kisan',
  vyapari: 'vyapari',
  other: null
}

export default function LoansPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const category = Form.useWatch('category', form) as LoanCategory | undefined
  const mode = Form.useWatch('mode', form) as LoanMode | undefined
  const [payLoan, setPayLoan] = useState<LoanRow | null>(null)
  const [detailLoan, setDetailLoan] = useState<LoanRow | null>(null)
  const [open, setOpen] = useState(false)

  const [accountFilter, setAccountFilter] = useState<number | undefined>()
  const [categoryFilter, setCategoryFilter] = useState<'all' | LoanCategory>('all')
  const [natureFilter, setNatureFilter] = useState<'all' | LoanNature>('all')
  const [range, setRange] = useState<[string, string] | undefined>()

  const banks = useQuery({
    queryKey: ['moneybook', 'accounts'],
    queryFn: () => window.api.moneybook.accounts()
  })
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => window.api.loans.list() })

  const rows = useMemo(() => {
    const all = (loans.data ?? []) as LoanRow[]
    return all.filter((r) => {
      if (accountFilter && r.accountId !== accountFilter) return false
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (natureFilter !== 'all' && r.nature !== natureFilter) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      return true
    })
  }, [loans.data, accountFilter, categoryFilter, natureFilter, range])

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.loans.create>[0]) =>
      window.api.loans.create(input),
    onSuccess: () => {
      message.success(t('loans.created'))
      setOpen(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['loans'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  // Restrict the party search to the category's account type; 'other' searches all.
  const partyType = category ? (CATEGORY_TYPE[category] ?? undefined) : undefined
  // For a bank loan, a real bank book (the cash/bank accounts other than plain Cash).
  const bankOptions = (banks.data ?? [])
    .filter((b) => b.name !== 'Cash')
    .map((b) => ({ value: b.id, label: b.name }))

  const columns = [
    { title: t('common.date'), dataIndex: 'date', width: 110 },
    { title: t('loans.party'), dataIndex: 'accountName' },
    {
      title: t('loans.category'),
      dataIndex: 'category',
      width: 90,
      render: (c: LoanCategory) => t(`loans.cat.${c}`)
    },
    {
      title: t('loans.nature'),
      dataIndex: 'nature',
      width: 100,
      render: (n: LoanNature) => (
        <Tooltip title={t(`loans.natureHelp.${n}`)}>
          <Tag color={n === 'direct' ? 'blue' : 'orange'}>{t(`loans.nature.${n}`)}</Tag>
        </Tooltip>
      )
    },
    {
      title: t('loans.principal'),
      dataIndex: 'principalPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => formatINR(v)
    },
    {
      title: (
        <Tooltip title={t('loans.interestHelp')}>
          <span>{t('loans.interest')}</span>
        </Tooltip>
      ),
      key: 'interest',
      align: 'right' as const,
      width: 120,
      render: (_: unknown, row: LoanRow) => {
        const interest = row.outstandingPaise - row.principalPaise
        return interest > 0 ? (
          <Typography.Text type="warning">+{formatINR(interest)}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )
      }
    },
    {
      title: t('loans.rate'),
      dataIndex: 'monthlyRateBps',
      align: 'right' as const,
      width: 80,
      render: (bps: number) => `${bps / 100}%`
    },
    {
      title: t('loans.outstanding'),
      dataIndex: 'outstandingPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => <strong>{formatINR(v)}</strong>
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 90,
      render: (_: unknown, row: LoanRow) => (
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            setPayLoan(row)
          }}
          disabled={row.outstandingPaise <= 0}
        >
          {t('loans.pay')}
        </Button>
      )
    }
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('loans.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('loans.new')}
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <AccountSearchSelect
          allowClear
          style={{ width: 200 }}
          placeholder={t('loans.searchAccount')}
          value={accountFilter}
          onChange={(v) => setAccountFilter(v)}
        />
        <Select
          style={{ width: 130 }}
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v)}
          options={[
            { value: 'all', label: t('common.all') },
            ...(['kisan', 'vyapari', 'other'] as LoanCategory[]).map((c) => ({
              value: c,
              label: t(`loans.cat.${c}`)
            }))
          ]}
        />
        <Select
          style={{ width: 130 }}
          value={natureFilter}
          onChange={(v) => setNatureFilter(v)}
          options={[
            { value: 'all', label: t('common.all') },
            ...(['direct', 'indirect'] as LoanNature[]).map((n) => ({
              value: n,
              label: t(`loans.nature.${n}`)
            }))
          ]}
        />
        <DatePicker.RangePicker
          format="YYYY-MM-DD"
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(_d, s) => setRange(s[0] && s[1] ? [s[0], s[1]] : undefined)}
        />
        {(accountFilter || categoryFilter !== 'all' || natureFilter !== 'all' || range) && (
          <Button
            type="link"
            onClick={() => {
              setAccountFilter(undefined)
              setCategoryFilter('all')
              setNatureFilter('all')
              setRange(undefined)
            }}
          >
            {t('loans.clearFilters')}
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loans.isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 15 }}
        onRow={(row) => ({
          onClick: () => setDetailLoan(row),
          style: { cursor: 'pointer' }
        })}
      />

      <Modal
        title={t('loans.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), category: 'kisan', mode: 'cash', nature: 'direct', rate: 1.5 }}
          onFinish={(v) =>
            create.mutate({
              category: v.category,
              accountId: v.accountId,
              date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
              amountPaise: toPaise(v.amount),
              mobile: v.mobile || undefined,
              mode: v.mode,
              bankAccountId: v.mode === 'bank' ? v.bankAccountId : undefined,
              nature: v.nature,
              monthlyRateBps: Math.round((v.rate ?? 1.5) * 100),
              remark: v.remark || undefined
            })
          }
        >
          <Space size="large" align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="category" label={t('loans.category')} rules={[{ required: true }]}>
              <Select
                style={{ width: 140 }}
                options={(['kisan', 'vyapari', 'other'] as LoanCategory[]).map((c) => ({
                  value: c,
                  label: t(`loans.cat.${c}`)
                }))}
              />
            </Form.Item>
            <Form.Item name="accountId" label={t('loans.party')} rules={[{ required: true }]}>
              <AccountSearchSelect
                type={partyType}
                placeholder={t('loans.party')}
                style={{ width: 200 }}
              />
            </Form.Item>
          </Space>

          <Space size="large" align="start" wrap>
            <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
              <InputNumber min={0} precision={2} prefix="₹" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="nature" label={t('loans.nature')} rules={[{ required: true }]}>
              <Select
                style={{ width: 140 }}
                options={(['direct', 'indirect'] as LoanNature[]).map((n) => ({
                  value: n,
                  label: t(`loans.nature.${n}`)
                }))}
              />
            </Form.Item>
            <Form.Item name="rate" label={t('loans.rate')} rules={[{ required: true }]}>
              <InputNumber min={0} precision={2} addonAfter="%/mo" style={{ width: 130 }} />
            </Form.Item>
          </Space>

          <Space size="large" align="start" wrap>
            <Form.Item name="mode" label={t('loans.mode')} rules={[{ required: true }]}>
              <Select
                style={{ width: 140 }}
                options={(['cash', 'bank'] as LoanMode[]).map((m) => ({
                  value: m,
                  label: t(`loans.mode.${m}`)
                }))}
              />
            </Form.Item>
            {mode === 'bank' && (
              <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
                <Select placeholder={t('loans.bank')} options={bankOptions} style={{ width: 180 }} />
              </Form.Item>
            )}
            <Form.Item name="mobile" label={t('loans.mobile')}>
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>

          <Form.Item name="remark" label={t('common.narration')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <LoanDetailDrawer
        loan={detailLoan}
        bankName={(id) => bankOptions.find((b) => b.value === id)?.label}
        onClose={() => setDetailLoan(null)}
        onPay={(loan) => {
          setDetailLoan(null)
          setPayLoan(loan)
        }}
      />

      {payLoan && (
        <PayModal
          loan={payLoan}
          bankOptions={bankOptions}
          onClose={() => setPayLoan(null)}
          onDone={() => {
            setPayLoan(null)
            queryClient.invalidateQueries({ queryKey: ['loans'] })
          }}
        />
      )}
    </div>
  )
}

const EVENT_COLOR: Record<LoanEventType, string> = {
  disbursement: 'blue',
  capitalisation: 'orange',
  payment: 'green'
}

/** Flatten every loan across a person's role-accounts into display rows, as of the bill's date. */
function loanComponentsOf(bill: Bill): Array<{
  loanId: number
  date: string
  nature: LoanNature
  outstandingPaise: number
  interestPaise: number
}> {
  return bill.sections.flatMap((sec) =>
    sec.loans.map((l) => ({
      loanId: l.loanId,
      date: l.date,
      nature: l.nature,
      outstandingPaise: l.liveOutstandingPaise,
      // interest sitting on top of the posted base (incl. live, not-yet-posted interest)
      interestPaise: l.liveOutstandingPaise - l.basePaise
    }))
  )
}

/**
 * Party-centric loan detail: everything `loan`'s party owes, decomposed into components
 * (each loan + its interest, rent, trade/other) **as of a chosen date** — sourced from the
 * Bills read model so the figures provably net to the party's total. Below, the clicked loan's
 * own terms and event history.
 */
function LoanDetailDrawer({
  loan,
  bankName,
  onClose,
  onPay
}: {
  loan: LoanRow | null
  bankName: (id: number | null) => string | undefined
  onClose: () => void
  onPay: (loan: LoanRow) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [asOf, setAsOf] = useState<string>(() => dayjs().format('YYYY-MM-DD'))

  const bill = useQuery({
    queryKey: ['bill', loan?.accountId, asOf],
    queryFn: () => window.api.bills.get(loan!.accountId, asOf),
    enabled: loan != null
  })
  const detail = useQuery({
    queryKey: ['loan', loan?.id, asOf],
    queryFn: () => window.api.loans.get(loan!.id, asOf),
    enabled: loan != null
  })
  // What a carried-forward indirect loan's principal is made of (from the closed source year).
  const composition = useQuery({
    queryKey: ['loanComposition', loan?.id],
    queryFn: () => window.api.loans.composition(loan!.id),
    enabled: loan != null && loan.nature === 'indirect'
  })

  const b = bill.data
  const d = detail.data
  const comp = composition.data

  const components = b ? loanComponentsOf(b) : []
  const loansOutstanding = components.reduce((s, c) => s + c.outstandingPaise, 0)
  const rentPaise = b ? b.sections.reduce((s, sec) => s + sec.standingBhadaPaise, 0) : 0
  const totalPaise = b?.combinedNetPaise ?? 0
  // The remainder of the net once loans and rent are accounted for — trade/other dealings.
  const tradeOtherPaise = totalPaise - loansOutstanding - rentPaise

  return (
    <Drawer
      open={loan != null}
      onClose={onClose}
      width={500}
      title={loan ? `${loan.accountName} — ${t(`loans.cat.${loan.category}`)}` : t('loans.title')}
      loading={bill.isLoading}
      extra={
        loan && (
          <Button type="primary" disabled={loan.outstandingPaise <= 0} onClick={() => onPay(loan)}>
            {t('loans.pay')}
          </Button>
        )
      }
    >
      {b && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space>
            <Typography.Text type="secondary">{t('loans.asOf')}:</Typography.Text>
            <DatePicker
              format="YYYY-MM-DD"
              allowClear={false}
              value={dayjs(asOf)}
              onChange={(dt) => dt && setAsOf(dt.format('YYYY-MM-DD'))}
            />
          </Space>

          <div>
            <Typography.Title level={5}>{t('loans.owedTitle', { date: asOf })}</Typography.Title>
            <Descriptions
              column={1}
              size="small"
              bordered
              items={[
                ...components.map((c) => ({
                  key: `loan-${c.loanId}`,
                  label: (
                    <Space size={4}>
                      <Tag color={c.nature === 'direct' ? 'blue' : 'orange'} style={{ margin: 0 }}>
                        {t(`loans.nature.${c.nature}`)}
                      </Tag>
                      <Typography.Text type="secondary">{c.date}</Typography.Text>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <strong>{formatINR(c.outstandingPaise)}</strong>
                      {c.interestPaise > 0 && (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          {t('loans.inclInterest', { amount: formatINR(c.interestPaise) })}
                        </Typography.Text>
                      )}
                    </Space>
                  )
                })),
                ...(rentPaise !== 0
                  ? [
                      {
                        key: 'rent',
                        label: t('loans.rentComponent'),
                        children: formatINR(rentPaise)
                      }
                    ]
                  : []),
                ...(tradeOtherPaise !== 0
                  ? [
                      {
                        key: 'trade',
                        label: t('loans.tradeComponent'),
                        children: formatINR(tradeOtherPaise)
                      }
                    ]
                  : []),
                {
                  key: 'total',
                  label: <strong>{t('loans.totalOwed')}</strong>,
                  children: <strong>{formatINR(totalPaise)}</strong>
                }
              ]}
            />
          </div>

          {comp && comp.lines.length > 0 && (
            <div>
              <Typography.Title level={5}>
                {t('loans.compTitle', { year: comp.sourceYear })}
              </Typography.Title>
              <Descriptions
                column={1}
                size="small"
                bordered
                items={[
                  ...comp.lines.map((l) => ({
                    key: l.tag,
                    label: t(`loans.comp.${l.tag}`),
                    children: formatINR(l.paise)
                  })),
                  {
                    key: 'comp-total',
                    label: <strong>{t('loans.principalTotal')}</strong>,
                    children: <strong>{formatINR(comp.totalPaise)}</strong>
                  }
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                {t('loans.compHelp', { year: comp.sourceYear })}
              </Typography.Paragraph>
            </div>
          )}

          {d && (
            <>
              <Descriptions
                column={1}
                size="small"
                title={t('loans.thisLoanTitle')}
                items={[
                  { key: 'nature', label: t('loans.nature'), children: t(`loans.nature.${d.nature}`) },
                  { key: 'date', label: t('loans.dateTaken'), children: d.date },
                  {
                    key: 'rate',
                    label: t('loans.rate'),
                    children: `${d.monthlyRateBps / 100}% / ${t('loans.perMonth')}`
                  },
                  { key: 'istart', label: t('loans.interestFrom'), children: d.interestStartDate },
                  {
                    key: 'mode',
                    label: t('loans.mode'),
                    children:
                      d.mode === 'bank'
                        ? `${t('loans.mode.bank')} — ${bankName(d.bankAccountId) ?? '—'}`
                        : t('loans.mode.cash')
                  },
                  { key: 'mobile', label: t('loans.mobile'), children: d.mobile || '—' },
                  { key: 'remark', label: t('common.narration'), children: d.remark || '—' }
                ]}
              />

              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {d.nature === 'indirect'
                  ? t('loans.natureHelp.indirect')
                  : t('loans.natureHelp.direct')}
              </Typography.Paragraph>

              <div>
                <Typography.Title level={5}>{t('loans.history')}</Typography.Title>
                <Timeline
                  items={d.events.map((e) => ({
                    color: EVENT_COLOR[e.type],
                    children: (
                      <Space direction="vertical" size={0}>
                        <Typography.Text>
                          {t(`loans.event.${e.type}`)} — <strong>{formatINR(e.amountPaise)}</strong>
                        </Typography.Text>
                        <Typography.Text type="secondary">{e.date}</Typography.Text>
                      </Space>
                    )
                  }))}
                />
              </div>
            </>
          )}
        </Space>
      )}
    </Drawer>
  )
}

function PayModal({
  loan,
  bankOptions,
  onClose,
  onDone
}: {
  loan: LoanRow
  bankOptions: { value: number; label: string }[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const mode = Form.useWatch('mode', form) as LoanMode | undefined

  const pay = useMutation({
    mutationFn: (v: { amount: number; date: dayjs.Dayjs; mode: LoanMode; bankAccountId?: number }) =>
      window.api.loans.pay(
        loan.id,
        toPaise(v.amount),
        v.date.format('YYYY-MM-DD'),
        v.mode,
        v.mode === 'bank' ? v.bankAccountId : undefined
      ),
    onSuccess: (r) => {
      message.success(t('loans.paid', { interest: formatINR(r.interestPaise) }))
      onDone()
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <Modal
      open
      title={`${t('loans.pay')} — ${loan.accountName}`}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={pay.isPending}
      okText={t('loans.pay')}
    >
      <Typography.Paragraph type="secondary">
        {t('loans.outstanding')}: <strong>{formatINR(loan.outstandingPaise)}</strong>
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), mode: 'cash' }} onFinish={(v) => pay.mutate(v)}>
        <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
          <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="mode" label={t('loans.mode')} rules={[{ required: true }]}>
          <Select
            options={(['cash', 'bank'] as LoanMode[]).map((m) => ({ value: m, label: t(`loans.mode.${m}`) }))}
          />
        </Form.Item>
        {mode === 'bank' && (
          <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
            <Select options={bankOptions} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
