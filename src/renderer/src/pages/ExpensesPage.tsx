import { useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { ExpenseRow, LoadingContractorYearRow } from '@shared/contracts'
import type { AccountType, PaymentMode } from '@shared/enums'
import { DATE_FORMAT, formatDate, formatINR, toPaise } from '../lib/format'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

/** Salary and loading payments share one register; `kind` tags which expense head a row hit. */
type ExpenseKind = 'salary' | 'loading'
type ExpenseRegisterRow = ExpenseRow & { kind: ExpenseKind }

const KIND_META: Record<
  ExpenseKind,
  { partyType: AccountType; labelKey: string; color: string; defaultNarration: string }
> = {
  salary: { partyType: 'staff', labelKey: 'expenses.staff', color: 'blue', defaultNarration: 'Staff salary' },
  loading: {
    partyType: 'loading_contractor',
    labelKey: 'expenses.contractor',
    color: 'gold',
    defaultNarration: 'Loading contractor charges'
  }
}

export default function ExpensesPage(): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  const [chargesOpen, setChargesOpen] = useState(false)

  const [kindFilter, setKindFilter] = useState<'all' | ExpenseKind>('all')
  const [partyFilter, setPartyFilter] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()
  const [minAmount, setMinAmount] = useState<number | undefined>()
  const [maxAmount, setMaxAmount] = useState<number | undefined>()
  const [narration, setNarration] = useState('')

  const salary = useQuery({ queryKey: ['salaryRegister'], queryFn: () => window.api.expenses.salaryRegister() })
  const loading = useQuery({ queryKey: ['loadingRegister'], queryFn: () => window.api.expenses.loadingRegister() })

  const allRows = useMemo<ExpenseRegisterRow[]>(() => {
    const s = (salary.data ?? []).map((r) => ({ ...r, kind: 'salary' as const }))
    const l = (loading.data ?? []).map((r) => ({ ...r, kind: 'loading' as const }))
    return [...s, ...l].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.voucherNo - a.voucherNo))
  }, [salary.data, loading.data])

  const rows = useMemo(() => {
    const min = minAmount != null ? toPaise(minAmount) : undefined
    const max = maxAmount != null ? toPaise(maxAmount) : undefined
    const term = narration.trim().toLowerCase()
    return allRows.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (partyFilter && r.partyAccountId !== partyFilter) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      if (min != null && r.amountPaise < min) return false
      if (max != null && r.amountPaise > max) return false
      if (term && !(r.narration ?? '').toLowerCase().includes(term)) return false
      return true
    })
  }, [allRows, kindFilter, partyFilter, range, minAmount, maxAmount, narration])

  const filtersActive =
    kindFilter !== 'all' || partyFilter || range || minAmount != null || maxAmount != null || narration.trim()

  const clearFilters = (): void => {
    setKindFilter('all')
    setPartyFilter(undefined)
    setRange(undefined)
    setMinAmount(undefined)
    setMaxAmount(undefined)
    setNarration('')
  }

  const { containerRef, rowClassName } = useTableKeyNav(rows, () => {})

  const columns = [
    { title: t('vouchers.no'), dataIndex: 'voucherNo', width: 70 },
    { title: t('common.date'), dataIndex: 'date', width: 120, render: (v: string) => formatDate(v) },
    {
      title: t('expenses.type'),
      dataIndex: 'kind',
      width: 130,
      render: (k: ExpenseKind) => <Tag color={KIND_META[k].color}>{t(`expenses.${k}`)}</Tag>
    },
    { title: t('expenses.party'), dataIndex: 'partyName', render: (n: string | null) => n ?? t('common.none') },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? t('common.none') },
    {
      title: t('common.amount'),
      dataIndex: 'amountPaise',
      align: 'right' as const,
      width: 150,
      render: (v: number) => formatINR(v)
    }
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('expenses.title')}
        </Typography.Title>
        <Space>
          <Button onClick={() => setChargesOpen(true)}>{t('expenses.contractorCharges')}</Button>
          <Button type="primary" onClick={() => setOpen(true)}>
            {t('expenses.new')}
          </Button>
        </Space>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 150 }}
          value={kindFilter}
          onChange={(v) => setKindFilter(v)}
          options={[
            { value: 'all', label: t('common.all') },
            ...(['salary', 'loading'] as ExpenseKind[]).map((k) => ({ value: k, label: t(`expenses.${k}`) }))
          ]}
        />
        <AccountSearchSelect
          allowClear
          style={{ width: 200 }}
          placeholder={t('expenses.searchParty')}
          value={partyFilter}
          onChange={(v) => setPartyFilter(v)}
        />
        <DatePicker.RangePicker
          format={DATE_FORMAT}
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
        />
        <InputNumber
          min={0}
          precision={2}
          prefix="₹"
          style={{ width: 130 }}
          placeholder={t('expenses.minAmount')}
          value={minAmount}
          onChange={(v) => setMinAmount(v ?? undefined)}
        />
        <InputNumber
          min={0}
          precision={2}
          prefix="₹"
          style={{ width: 130 }}
          placeholder={t('expenses.maxAmount')}
          value={maxAmount}
          onChange={(v) => setMaxAmount(v ?? undefined)}
        />
        <Input
          allowClear
          style={{ width: 200 }}
          placeholder={t('expenses.searchNarration')}
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
        />
        {filtersActive && (
          <Button type="link" onClick={clearFilters}>
            {t('expenses.clearFilters')}
          </Button>
        )}
      </Space>

      <div ref={containerRef}>
      <Table
        rowKey="voucherId"
        size="small"
        loading={salary.isLoading || loading.isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 15 }}
        rowClassName={rowClassName}
        summary={(data) => {
          const total = data.reduce((s, r) => s + r.amountPaise, 0)
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={5}>
                <strong>{t('common.total')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <strong>{formatINR(total)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )
        }}
      />
      </div>

      <NewExpenseModal open={open} onClose={() => setOpen(false)} />
      <ContractorChargesDrawer open={chargesOpen} onClose={() => setChargesOpen(false)} />
    </div>
  )
}

/** Record one expense payment: pick the head (salary/loading), then Dr Expense / Cr Cash-Bank. */
function NewExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })
  const kind = (Form.useWatch('kind', form) as ExpenseKind | undefined) ?? 'salary'
  const mode = Form.useWatch('mode', form) as PaymentMode | undefined

  const banks = useQuery({ queryKey: ['moneybook', 'accounts'], queryFn: () => window.api.moneybook.accounts() })
  const bankOptions = (banks.data ?? []).filter((b) => b.name !== 'Cash').map((b) => ({ value: b.id, label: b.name }))

  const pay = useMutation({
    mutationFn: (v: {
      kind: ExpenseKind
      partyAccountId: number
      amountPaise: number
      date: string
      mode: PaymentMode
      bankAccountId?: number
      narration?: string
    }) => {
      const input = {
        partyAccountId: v.partyAccountId,
        amountPaise: v.amountPaise,
        date: v.date,
        mode: v.mode,
        bankAccountId: v.bankAccountId,
        narration: v.narration
      }
      return v.kind === 'salary' ? window.api.expenses.paySalary(input) : window.api.expenses.payLoading(input)
    },
    onSuccess: (_r, v) => {
      message.success(t('expenses.paid'))
      queryClient.invalidateQueries({ queryKey: [v.kind === 'salary' ? 'salaryRegister' : 'loadingRegister'] })
      form.resetFields()
      onClose()
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <Modal
      title={t('expenses.new')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={pay.isPending}
      okText={t('expenses.pay')}
    >
      <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: dayjs(), kind: 'salary', mode: 'cash' }}
        onFinish={(v) =>
          pay.mutate({
            kind: v.kind,
            partyAccountId: v.partyAccountId,
            amountPaise: toPaise(v.amount),
            date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
            mode: v.mode,
            bankAccountId: v.mode === 'bank' ? v.bankAccountId : undefined,
            narration: v.narration || undefined
          })
        }
      >
        <Form.Item name="kind" label={t('expenses.type')} rules={[{ required: true }]}>
          <Select
            // Switching head changes which party type is valid — drop the stale party.
            onChange={() => form.setFieldValue('partyAccountId', undefined)}
            options={(['salary', 'loading'] as ExpenseKind[]).map((k) => ({ value: k, label: t(`expenses.${k}`) }))}
          />
        </Form.Item>
        <Form.Item name="partyAccountId" label={t(KIND_META[kind].labelKey)} rules={[{ required: true }]}>
          <AccountSearchSelect
            type={KIND_META[kind].partyType}
            placeholder={t(KIND_META[kind].labelKey)}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
          <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="mode" label={t('loans.mode')} rules={[{ required: true }]}>
          <Select
            options={(['cash', 'bank'] as PaymentMode[]).map((m) => ({ value: m, label: t(`loans.mode.${m}`) }))}
          />
        </Form.Item>
        {mode === 'bank' && (
          <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
            <Select placeholder={t('loans.bank')} options={bankOptions} />
          </Form.Item>
        )}
        <Form.Item name="narration" label={t('common.narration')}>
          <Input placeholder={t('common.narration')} />
        </Form.Item>
      </Form>
      </div>
    </Modal>
  )
}

/**
 * The lump-sum yearly amounts each loading contractor quoted. Loading and unloading are
 * independent — one may still be undecided (blank) and filled in later in the year.
 */
function ContractorChargesDrawer({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editRow, setEditRow] = useState<LoadingContractorYearRow | null>(null)

  const years = useQuery({
    queryKey: ['loadingYears'],
    queryFn: () => window.api.expenses.loadingYears(),
    enabled: open
  })

  const yearColumns = [
    { title: t('expenses.contractor'), dataIndex: 'accountName' },
    {
      title: t('expenses.loadingAmount'),
      dataIndex: 'loadingAmountPaise',
      align: 'right' as const,
      render: (v: number | null) => (v === null ? t('expenses.notDecided') : formatINR(v))
    },
    {
      title: t('expenses.unloadingAmount'),
      dataIndex: 'unloadingAmountPaise',
      align: 'right' as const,
      render: (v: number | null) => (v === null ? t('expenses.notDecided') : formatINR(v))
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 90,
      render: (_: unknown, row: LoadingContractorYearRow) => (
        <Button size="small" onClick={() => setEditRow(row)}>
          {t('common.save')}
        </Button>
      )
    }
  ]

  return (
    <Drawer open={open} onClose={onClose} width={720} title={t('expenses.contractorCharges')}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t('expenses.yearCharges')}
      </Typography.Title>
      <Table
        rowKey="accountId"
        size="small"
        loading={years.isLoading}
        columns={yearColumns}
        dataSource={(years.data ?? []) as LoadingContractorYearRow[]}
        pagination={false}
        locale={{ emptyText: t('expenses.noContractors') }}
      />
      {editRow && (
        <ChargesModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => {
            setEditRow(null)
            queryClient.invalidateQueries({ queryKey: ['loadingYears'] })
          }}
        />
      )}
    </Drawer>
  )
}

function ChargesModal({
  row,
  onClose,
  onDone
}: {
  row: LoadingContractorYearRow
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ onAccept: () => form.submit() })
  const save = useMutation({
    mutationFn: (input: Parameters<typeof window.api.expenses.setLoadingYear>[0]) =>
      window.api.expenses.setLoadingYear(input),
    onSuccess: () => {
      message.success(t('expenses.saved'))
      onDone()
    },
    onError: (e: Error) => message.error(e.message)
  })
  return (
    <Modal
      open
      title={`${t('expenses.yearCharges')} — ${row.accountName}`}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText={t('common.save')}
    >
      <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          loadingAmount: row.loadingAmountPaise === null ? undefined : row.loadingAmountPaise / 100,
          unloadingAmount: row.unloadingAmountPaise === null ? undefined : row.unloadingAmountPaise / 100
        }}
        onFinish={(v) =>
          save.mutate({
            accountId: row.accountId,
            loadingAmountPaise: v.loadingAmount == null ? null : toPaise(v.loadingAmount),
            unloadingAmountPaise: v.unloadingAmount == null ? null : toPaise(v.unloadingAmount)
          })
        }
      >
        <Form.Item name="loadingAmount" label={t('expenses.loadingAmount')} extra={t('expenses.amountHint')}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="unloadingAmount" label={t('expenses.unloadingAmount')} extra={t('expenses.amountHint')}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
      </Form>
      </div>
    </Modal>
  )
}
