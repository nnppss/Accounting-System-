import { useMemo, useRef, useState } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  App as AntApp,
  Button,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography
} from 'antd'
import { ArrowLeftOutlined, FileExcelOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageBanner } from '../components/report'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { Bill, LoanRow, PartyLoanEventRow } from '@shared/contracts'
import type { LoanCategory, LoanEventType, LoanMode, LoanNature } from '@shared/enums'
import { DATE_FORMAT, DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import { SeverityText, interestSeverity, severityRowClass } from '../components/Highlight'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { loanNarration, useAutoNarration } from '../lib/narration'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { useFormKeyNav } from '../lib/useFormKeyNav'

const CATEGORY_TYPE: Record<LoanCategory, 'kisan' | 'vyapari' | null> = {
  kisan: 'kisan',
  vyapari: 'vyapari',
  other: null
}

/** Everything one party owes on loan, as the Loans list shows it: his loans rolled into one row. */
type PartyRow = {
  accountId: number
  accountName: string
  sonOf: string | null
  /** 'mixed' when he holds loans under more than one hat (kisan and vyapari, say). */
  category: LoanCategory | 'mixed'
  /** The most recent loan he took — what the list sorts on. */
  latestDate: string
  principalPaise: number
  outstandingPaise: number
  loans: LoanRow[]
}

export default function LoansPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const category = Form.useWatch('category', form) as LoanCategory | undefined
  const mode = Form.useWatch('mode', form) as LoanMode | undefined
  const nature = Form.useWatch('nature', form) as LoanNature | undefined
  const [partyName, setPartyName] = useState('')
  useAutoNarration(form, loanNarration(partyName), 'remark')
  const [payParty, setPayParty] = useState<PartyRow | null>(null)
  const [detailParty, setDetailParty] = useState<PartyRow | null>(null)
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  // Set by "Save & new" so the success handler clears the form instead of closing it.
  const again = useRef(false)
  const submit = (addAnother: boolean) => (): void => {
    again.current = addAnother
    form.submit()
  }
  const formNav = useFormKeyNav({ open, onAccept: submit(false) })
  const filterNav = useFormKeyNav({ onAccept: () => (document.activeElement as HTMLElement | null)?.blur() })

  // Keep the date — a run of entries is nearly always for the same day.
  const clearForNext = (): void => {
    const date = form.getFieldValue('date')
    form.resetFields()
    form.setFieldValue('date', date)
    setPartyName('')
    formNav.focusFirst()
  }

  const [accountFilter, setAccountFilter] = useState<number | undefined>()
  const [categoryFilter, setCategoryFilter] = useState<'all' | LoanCategory>('all')
  const [natureFilter, setNatureFilter] = useState<'all' | LoanNature>('all')
  const [range, setRange] = useState<[string, string] | undefined>()

  const banks = useQuery({
    queryKey: ['moneybook', 'accounts'],
    queryFn: () => window.api.moneybook.accounts()
  })
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => window.api.loans.list() })

  // One row per party, not per loan: the cold lends to the man and settles with the man, so his
  // loans are a history behind a single figure — Σprincipal, Σinterest, Σoutstanding. They keep
  // their own rates and dates underneath (which is why 'rate' is a column only when they agree).
  const rows = useMemo(() => {
    const kept = ((loans.data ?? []) as LoanRow[]).filter((r) => {
      if (accountFilter && r.accountId !== accountFilter) return false
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (natureFilter !== 'all' && r.nature !== natureFilter) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      return true
    })
    const byParty = new Map<number, PartyRow>()
    for (const l of kept) {
      const p = byParty.get(l.accountId)
      if (!p) {
        byParty.set(l.accountId, {
          accountId: l.accountId,
          accountName: l.accountName,
          sonOf: l.sonOf,
          category: l.category,
          latestDate: l.date,
          principalPaise: l.principalPaise,
          outstandingPaise: l.outstandingPaise,
          loans: [l]
        })
        continue
      }
      p.principalPaise += l.principalPaise
      p.outstandingPaise += l.outstandingPaise
      p.loans.push(l)
      if (l.date > p.latestDate) p.latestDate = l.date
      // A man can hold loans under more than one hat; the row says so rather than picking one.
      if (p.category !== l.category) p.category = 'mixed'
    }
    return [...byParty.values()].sort((a, b) =>
      a.latestDate === b.latestDate ? a.accountName.localeCompare(b.accountName) : a.latestDate < b.latestDate ? 1 : -1
    )
  }, [loans.data, accountFilter, categoryFilter, natureFilter, range])

  const { containerRef, rowClassName: keyNavRowClass } = useTableKeyNav(
    rows,
    (row) => setDetailParty(row)
  )

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.loans.create>[0]) =>
      window.api.loans.create(input),
    onSuccess: () => {
      message.success(t('loans.created'))
      if (again.current) clearForNext()
      else {
        setOpen(false)
        form.resetFields()
        setPartyName('')
      }
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
    {
      title: t('loans.party'),
      dataIndex: 'accountName',
      render: (name: string, row: PartyRow) => (
        <>
          {name}
          {row.sonOf && <Typography.Text type="secondary"> s/o {row.sonOf}</Typography.Text>}
        </>
      )
    },
    {
      title: t('loans.category'),
      dataIndex: 'category',
      width: 90,
      render: (c: LoanCategory | 'mixed') =>
        c === 'mixed' ? t('loans.cat.mixed') : t(`loans.cat.${c}`)
    },
    {
      title: t('loans.loanCount'),
      key: 'count',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, row: PartyRow) => row.loans.length
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
      render: (_: unknown, row: PartyRow) => {
        const interest = row.outstandingPaise - row.principalPaise
        return interest > 0 ? (
          <SeverityText severity="warning" strong>
            +{formatINR(interest)}
          </SeverityText>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )
      }
    },
    {
      // His loans can each run at their own rate; one figure would be a lie, so say so.
      title: t('loans.rate'),
      key: 'rate',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, row: PartyRow) => {
        const rates = [...new Set(row.loans.map((l) => l.monthlyRateBps))]
        return rates.length === 1 ? (
          `${rates[0] / 100}%`
        ) : (
          <Tooltip title={rates.map((r) => `${r / 100}%`).join(', ')}>
            <Typography.Text type="secondary">{t('loans.mixedRates')}</Typography.Text>
          </Tooltip>
        )
      }
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
      width: 130,
      render: (_: unknown, row: PartyRow) => (
        <Space size={4}>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setPayParty(row)
            }}
            disabled={row.outstandingPaise <= 0}
          >
            {t('loans.pay')}
          </Button>
          {/* His loans on paper — the register, cut to this one man. */}
          <Button
            size="small"
            type="text"
            icon={<PrinterOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              print(() => window.api.print.loanRegister(row.loans))
            }}
          />
        </Space>
      )
    }
  ]

  return (
    <div>
      <PageBanner
        title={t('loans.title')}
        extra={
          <Space>
            {/* The register is a loan-by-loan document, so it prints the loans behind the rows. */}
            <Button
              icon={<PrinterOutlined />}
              onClick={() => print(() => window.api.print.loanRegister(rows.flatMap((r) => r.loans)))}
            >
              {t('common.print')}
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() =>
                exportXlsx(
                  'loan-register.xlsx',
                  t('loans.title'),
                  ['Date', 'Party', 'Category', 'Principal', 'Mode', 'Nature', 'Rate %/mo', 'Outstanding'],
                  rows
                    .flatMap((r) => r.loans)
                    .map((l) => [
                      formatDate(l.date),
                      l.accountName,
                      l.category,
                      paiseToRupees(l.principalPaise),
                      l.mode,
                      l.nature,
                      l.monthlyRateBps / 100,
                      paiseToRupees(l.outstandingPaise)
                    ]),
                  [3, 7] // Principal, Outstanding
                )
              }
            >
              {t('common.excel')}
            </Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('loans.new')}
            </Button>
          </Space>
        }
      />

      {detailParty ? (
        <PartyLoanDetail
          party={detailParty}
          onBack={() => setDetailParty(null)}
          onPay={(party) => {
            setDetailParty(null)
            setPayParty(party)
          }}
        />
      ) : (
        <>
      <div ref={filterNav.containerRef} onKeyDownCapture={filterNav.onKeyDownCapture}>
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
          format={DATE_INPUT_FORMATS}
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
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
      </div>

      <div ref={containerRef}>
        <Table
          className="pc-report"
          rowKey="accountId"
          size="small"
          loading={loans.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 15 }}
          rowClassName={(row, i) =>
            [severityRowClass(interestSeverity(row.outstandingPaise - row.principalPaise)), keyNavRowClass(row, i)].filter(Boolean).join(' ')
          }
          onRow={(row) => ({
            onClick: () => setDetailParty(row),
            style: { cursor: 'pointer' }
          })}
        />
      </div>
        </>
      )}

      <AutoFocusModal
        title={t('loans.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit(false)}
        onOkAndNew={submit(true)}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={640}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
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
              bankAccountId: v.mode !== 'cash' ? v.bankAccountId : undefined,
              chequeNo: v.mode === 'cheque' ? v.chequeNo : undefined,
              chequeBank: v.mode === 'cheque' ? v.chequeBank || undefined : undefined,
              chequeClearanceDate:
                v.mode === 'cheque' && v.chequeClearanceDate
                  ? (v.chequeClearanceDate as dayjs.Dayjs).format('YYYY-MM-DD')
                  : undefined,
              nature: v.nature,
              monthlyRateBps: Math.round((v.rate ?? 1.5) * 100),
              remark: v.remark || undefined
            })
          }
        >
          <Space size="large" align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_INPUT_FORMATS} />
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
                onChange={(_, name) => setPartyName(name ?? '')}
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
                // An indirect loan moves no money, so a cheque makes no sense there.
                options={((nature === 'indirect' ? ['cash', 'bank'] : ['cash', 'bank', 'cheque']) as LoanMode[]).map((m) => ({
                  value: m,
                  label: t(`loans.mode.${m}`)
                }))}
              />
            </Form.Item>
            {mode !== 'cash' && (
              <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
                <Select placeholder={t('loans.bank')} options={bankOptions} style={{ width: 180 }} />
              </Form.Item>
            )}
            <Form.Item name="mobile" label={t('loans.mobile')}>
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>

          {mode === 'cheque' && (
            <Space size="large" align="start" wrap>
              <Form.Item name="chequeNo" label={t('cheques.no')} rules={[{ required: true }]}>
                <Input style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="chequeBank" label={t('cheques.bank')}>
                <Input style={{ width: 180 }} />
              </Form.Item>
              <Form.Item name="chequeClearanceDate" label={t('cheques.clearanceDate')}>
                <DatePicker format={DATE_FORMAT} />
              </Form.Item>
            </Space>
          )}

          <Form.Item name="remark" label={t('common.narration')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        </div>
      </AutoFocusModal>

      {payParty && (
        <PayModal
          party={payParty}
          bankOptions={bankOptions}
          onClose={() => setPayParty(null)}
          onDone={() => {
            setPayParty(null)
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
  interest_fix: 'purple',
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
 * Everything one party owes on loan, in one place. The cold lends to the man, not to each of his
 * loans, so this is the man's page: the top panel decomposes what he owes as of a chosen date
 * (each loan + its interest, rent, trade/other) from the Bills read model, so the figures provably
 * net to his total. Then his loans on their own terms, and finally the whole run of what has
 * happened across all of them — given, interest, repaid — as one history.
 *
 * Takes over the page where the list was, rather than sliding a panel over it — there are four
 * stacked sections here and they want the full width, and nothing on the list behind is worth
 * keeping in view. Back returns to it.
 */
function PartyLoanDetail({
  party,
  onBack,
  onPay
}: {
  party: PartyRow
  onBack: () => void
  onPay: (party: PartyRow) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = AntApp.useApp()
  const print = usePrinter()
  const queryClient = useQueryClient()
  const [asOf, setAsOf] = useState<string>(() => dayjs().format('YYYY-MM-DD'))

  const bill = useQuery({
    queryKey: ['bill', party.accountId, asOf],
    queryFn: () => window.api.bills.get(party.accountId, asOf)
  })
  const events = useQuery({
    queryKey: ['partyLoanEvents', party.accountId],
    queryFn: () => window.api.loans.partyEvents(party.accountId)
  })

  const undo = useMutation({
    mutationFn: (eventId: number) => window.api.loans.undoPayment(eventId),
    onSuccess: () => {
      message.success(t('loans.paymentUndone'))
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      queryClient.invalidateQueries({ queryKey: ['partyLoanEvents'] })
      queryClient.invalidateQueries({ queryKey: ['bill'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['vouchers'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const b = bill.data
  const evs = events.data ?? []
  // Undo is offered only on the last-entered event of its OWN loan — anything later on that loan
  // was computed on top of it, which is exactly what the service refuses. Compared by id, not by
  // position: the run is ordered by date, so a backdated payment isn't necessarily the last one in.
  const newestByLoan = new Map<number, number>()
  for (const e of evs) newestByLoan.set(e.loanId, Math.max(newestByLoan.get(e.loanId) ?? 0, e.id))
  const canUndo = (e: PartyLoanEventRow): boolean =>
    e.type === 'payment' && newestByLoan.get(e.loanId) === e.id

  const components = b ? loanComponentsOf(b) : []
  const loansOutstanding = components.reduce((s, c) => s + c.outstandingPaise, 0)
  const rentPaise = b ? b.sections.reduce((s, sec) => s + sec.standingBhadaPaise, 0) : 0
  const totalPaise = b?.combinedNetPaise ?? 0
  // The remainder of the net once loans and rent are accounted for — trade/other dealings.
  const tradeOtherPaise = totalPaise - loansOutstanding - rentPaise

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          {t('common.back')}
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {party.accountName}
          {party.sonOf && (
            <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>
              {' '}
              s/o {party.sonOf}
            </Typography.Text>
          )}
        </Typography.Title>
        <Button type="primary" disabled={party.outstandingPaise <= 0} onClick={() => onPay(party)}>
          {t('loans.pay')}
        </Button>
      </Space>

      {b && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space>
            <Typography.Text type="secondary">{t('loans.asOf')}:</Typography.Text>
            <DatePicker
              format={DATE_INPUT_FORMATS}
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
                      <Typography.Text type="secondary">{formatDate(c.date)}</Typography.Text>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <strong>{formatINR(c.outstandingPaise)}</strong>
                      {c.interestPaise > 0 && (
                        <SeverityText severity="warning" style={{ fontSize: 12 }}>
                          {t('loans.inclInterest', { amount: formatINR(c.interestPaise) })}
                        </SeverityText>
                      )}
                    </Space>
                  )
                })),
                ...(rentPaise !== 0
                  ? [{ key: 'rent', label: t('loans.rentComponent'), children: formatINR(rentPaise) }]
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

          <div>
            <Typography.Title level={5}>
              {t('loans.hisLoans', { count: party.loans.length })}
            </Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={party.loans}
              columns={[
                {
                  title: t('common.date'),
                  dataIndex: 'date',
                  render: (v: string) => formatDate(v)
                },
                {
                  title: t('loans.nature'),
                  dataIndex: 'nature',
                  render: (n: LoanNature) => (
                    <Tooltip title={t(`loans.natureHelp.${n}`)}>
                      <Tag color={n === 'direct' ? 'blue' : 'orange'}>{t(`loans.nature.${n}`)}</Tag>
                    </Tooltip>
                  )
                },
                {
                  title: t('loans.rate'),
                  dataIndex: 'monthlyRateBps',
                  align: 'right' as const,
                  render: (bps: number) => `${bps / 100}%`
                },
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
                },
                {
                  key: 'print',
                  width: 40,
                  render: (_: unknown, l: LoanRow) => (
                    <Button
                      size="small"
                      type="text"
                      icon={<PrinterOutlined />}
                      title={t('loans.statement')}
                      onClick={() => print(() => window.api.print.loanStatement(l.id))}
                    />
                  )
                }
              ]}
              expandable={{
                // Only a carried-forward indirect loan is made of anything — a direct one is just
                // cash handed over. Rendered on expand, so the query only runs if he looks.
                rowExpandable: (l) => l.nature === 'indirect',
                expandedRowRender: (l) => <LoanCompositionPanel loanId={l.id} />
              }}
            />
          </div>

          <div>
            <Typography.Title level={5}>{t('loans.history')}</Typography.Title>
            <Timeline
              items={evs.map((e) => ({
                color: EVENT_COLOR[e.type],
                children: (
                  <Space direction="vertical" size={0}>
                    <Typography.Text>
                      {t(`loans.event.${e.type}`)} — <strong>{formatINR(e.amountPaise)}</strong>
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {formatDate(e.date)}
                      {party.loans.length > 1 && (
                        <> · {t('loans.ofLoan', { date: formatDate(e.loanDate) })}</>
                      )}
                    </Typography.Text>
                    {canUndo(e) && (
                      <Button
                        size="small"
                        danger
                        type="link"
                        style={{ padding: 0 }}
                        loading={undo.isPending}
                        onClick={() =>
                          modal.confirm({
                            title: t('loans.undoPayment'),
                            content: t('loans.undoPaymentHint', {
                              amount: formatINR(e.amountPaise),
                              date: formatDate(e.date)
                            }),
                            okText: t('loans.undoPayment'),
                            okButtonProps: { danger: true },
                            onOk: () => undo.mutateAsync(e.id)
                          })
                        }
                      >
                        {t('loans.undoPayment')}
                      </Button>
                    )}
                  </Space>
                )
              }))}
            />
          </div>
        </Space>
      )}
    </>
  )
}

/** What a carried-forward indirect loan's principal is made of, from the closed source year. */
function LoanCompositionPanel({ loanId }: { loanId: number }): JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['loanComposition', loanId],
    queryFn: () => window.api.loans.composition(loanId)
  })
  const comp = q.data
  if (!comp || comp.lines.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
  return (
    <>
      <Descriptions
        column={1}
        size="small"
        bordered
        title={t('loans.compTitle', { year: comp.sourceYear })}
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
    </>
  )
}

/**
 * Take a repayment. Interest is settled with the man as a whole, but the money itself lands on one
 * loan — each carries its own rate and base, so there is nowhere neutral to put it. When he has
 * more than one running, the loan is picked here; with a single loan there is nothing to ask.
 */
function PayModal({
  party,
  bankOptions,
  onClose,
  onDone
}: {
  party: PartyRow
  bankOptions: { value: number; label: string }[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ onAccept: () => form.submit() })
  const mode = Form.useWatch('mode', form) as LoanMode | undefined
  const payable = party.loans.filter((l) => l.outstandingPaise > 0)
  const watchLoanId = Form.useWatch('loanId', form) as number | undefined
  const loan = payable.find((l) => l.id === watchLoanId) ?? payable[0]

  const pay = useMutation({
    mutationFn: (v: {
      loanId: number
      amount: number
      date: dayjs.Dayjs
      mode: LoanMode
      bankAccountId?: number
      chequeNo?: string
      chequeBank?: string
    }) =>
      window.api.loans.pay(
        v.loanId,
        toPaise(v.amount),
        v.date.format('YYYY-MM-DD'),
        v.mode,
        v.mode !== 'cash' ? v.bankAccountId : undefined,
        v.mode === 'cheque' ? v.chequeNo : undefined,
        v.mode === 'cheque' ? v.chequeBank || undefined : undefined
      ),
    onSuccess: (r) => {
      message.success(t('loans.paid', { interest: formatINR(r.interestPaise) }))
      onDone()
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <AutoFocusModal
      open
      title={`${t('loans.pay')} — ${party.accountName}`}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={pay.isPending}
      okText={t('loans.pay')}
    >
      <Typography.Paragraph type="secondary">
        {t('loans.outstanding')}: <strong>{formatINR(loan?.outstandingPaise ?? 0)}</strong>
      </Typography.Paragraph>
      <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: dayjs(), mode: 'cash', loanId: payable[0]?.id }}
        onFinish={(v) => pay.mutate(v)}
      >
        {payable.length > 1 && (
          <Form.Item name="loanId" label={t('loans.againstLoan')} rules={[{ required: true }]}>
            <Select
              options={payable.map((l) => ({
                value: l.id,
                label: `${formatDate(l.date)} · ${l.monthlyRateBps / 100}% · ${formatINR(l.outstandingPaise)}`
              }))}
            />
          </Form.Item>
        )}
        <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
          <DatePicker format={DATE_INPUT_FORMATS} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="mode" label={t('loans.mode')} rules={[{ required: true }]}>
          <Select
            options={(['cash', 'bank', 'cheque'] as LoanMode[]).map((m) => ({ value: m, label: t(`loans.mode.${m}`) }))}
          />
        </Form.Item>
        {mode !== 'cash' && (
          <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
            <Select options={bankOptions} />
          </Form.Item>
        )}
        {mode === 'cheque' && (
          <>
            <Form.Item name="chequeNo" label={t('cheques.no')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="chequeBank" label={t('cheques.bank')}>
              <Input />
            </Form.Item>
          </>
        )}
      </Form>
      </div>
    </AutoFocusModal>
  )
}
