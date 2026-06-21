import { useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tabs,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { ExpenseRow, LoadingContractorYearRow } from '@shared/contracts'
import type { AccountType, PaymentMode } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'

/** Shared salary / loading payment form: Dr Expense / Cr Cash-Bank. */
function PayForm({
  partyType,
  partyLabel,
  onPay,
  pending
}: {
  partyType: AccountType
  partyLabel: string
  onPay: (input: {
    partyAccountId: number
    amountPaise: number
    date: string
    mode: PaymentMode
    bankAccountId?: number
    narration?: string
  }) => void
  pending: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const mode = Form.useWatch('mode', form) as PaymentMode | undefined

  const parties = useQuery({
    queryKey: ['accounts', partyType],
    queryFn: () => window.api.accounts.list({ type: partyType })
  })
  const banks = useQuery({ queryKey: ['moneybook', 'accounts'], queryFn: () => window.api.moneybook.accounts() })
  const partyOptions = (parties.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  const bankOptions = (banks.data ?? []).filter((b) => b.name !== 'Cash').map((b) => ({ value: b.id, label: b.name }))

  return (
    <Card style={{ marginBottom: 24 }}>
      <Form
        form={form}
        layout="inline"
        initialValues={{ date: dayjs(), mode: 'cash' }}
        onFinish={(v) => {
          onPay({
            partyAccountId: v.partyAccountId,
            amountPaise: toPaise(v.amount),
            date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
            mode: v.mode,
            bankAccountId: v.mode === 'bank' ? v.bankAccountId : undefined,
            narration: v.narration || undefined
          })
          form.resetFields()
        }}
      >
        <Form.Item name="partyAccountId" rules={[{ required: true }]}>
          <Select
            placeholder={partyLabel}
            options={partyOptions}
            showSearch
            optionFilterProp="label"
            style={{ width: 180 }}
          />
        </Form.Item>
        <Form.Item name="amount" rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" placeholder={t('common.amount')} />
        </Form.Item>
        <Form.Item name="date" rules={[{ required: true }]}>
          <DatePicker format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item name="mode" rules={[{ required: true }]}>
          <Select
            style={{ width: 110 }}
            options={(['cash', 'bank'] as PaymentMode[]).map((m) => ({ value: m, label: t(`loans.mode.${m}`) }))}
          />
        </Form.Item>
        {mode === 'bank' && (
          <Form.Item name="bankAccountId" rules={[{ required: true }]}>
            <Select placeholder={t('loans.bank')} options={bankOptions} style={{ width: 150 }} />
          </Form.Item>
        )}
        <Form.Item name="narration">
          <Input placeholder={t('common.narration')} style={{ width: 180 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={pending}>
            {t('expenses.pay')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

function Register({ rows, loading }: { rows: ExpenseRow[]; loading: boolean }): JSX.Element {
  const { t } = useTranslation()
  const columns = [
    { title: t('vouchers.no'), dataIndex: 'voucherNo', width: 70 },
    { title: t('common.date'), dataIndex: 'date', width: 120 },
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
    <Table
      rowKey="voucherId"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 12 }}
      summary={(data) => {
        const total = data.reduce((s, r) => s + r.amountPaise, 0)
        return (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={4}>
              <strong>{t('common.total')}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">
              <strong>{formatINR(total)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )
      }}
    />
  )
}

function SalaryTab(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const register = useQuery({ queryKey: ['salaryRegister'], queryFn: () => window.api.expenses.salaryRegister() })
  const pay = useMutation({
    mutationFn: (input: Parameters<typeof window.api.expenses.paySalary>[0]) =>
      window.api.expenses.paySalary(input),
    onSuccess: () => {
      message.success(t('expenses.paid'))
      queryClient.invalidateQueries({ queryKey: ['salaryRegister'] })
    },
    onError: (e: Error) => message.error(e.message)
  })
  return (
    <>
      <PayForm partyType="staff" partyLabel={t('expenses.staff')} onPay={pay.mutate} pending={pay.isPending} />
      <Register rows={(register.data ?? []) as ExpenseRow[]} loading={register.isLoading} />
    </>
  )
}

function LoadingTab(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [editRow, setEditRow] = useState<LoadingContractorYearRow | null>(null)

  const years = useQuery({ queryKey: ['loadingYears'], queryFn: () => window.api.expenses.loadingYears() })
  const register = useQuery({ queryKey: ['loadingRegister'], queryFn: () => window.api.expenses.loadingRegister() })

  const pay = useMutation({
    mutationFn: (input: Parameters<typeof window.api.expenses.payLoading>[0]) =>
      window.api.expenses.payLoading(input),
    onSuccess: () => {
      message.success(t('expenses.paid'))
      queryClient.invalidateQueries({ queryKey: ['loadingRegister'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const yearColumns = [
    { title: t('expenses.contractor'), dataIndex: 'accountName' },
    {
      title: t('expenses.loadingCharge'),
      dataIndex: 'loadingChargePaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('expenses.unloadingCharge'),
      dataIndex: 'unloadingChargePaise',
      align: 'right' as const,
      render: (v: number) => formatINR(v)
    },
    { title: t('expenses.labourersLoading'), dataIndex: 'labourersLoading', align: 'right' as const, width: 110 },
    { title: t('expenses.labourersUnloading'), dataIndex: 'labourersUnloading', align: 'right' as const, width: 110 },
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
    <>
      <Typography.Title level={5}>{t('expenses.yearCharges')}</Typography.Title>
      <Table
        rowKey="accountId"
        size="small"
        style={{ marginBottom: 24 }}
        loading={years.isLoading}
        columns={yearColumns}
        dataSource={(years.data ?? []) as LoadingContractorYearRow[]}
        pagination={false}
        locale={{ emptyText: t('expenses.noContractors') }}
      />

      <Typography.Title level={5}>{t('expenses.payments')}</Typography.Title>
      <PayForm
        partyType="loading_contractor"
        partyLabel={t('expenses.contractor')}
        onPay={pay.mutate}
        pending={pay.isPending}
      />
      <Register rows={(register.data ?? []) as ExpenseRow[]} loading={register.isLoading} />

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
    </>
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
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          loadingCharge: row.loadingChargePaise / 100,
          unloadingCharge: row.unloadingChargePaise / 100,
          labourersLoading: row.labourersLoading,
          labourersUnloading: row.labourersUnloading
        }}
        onFinish={(v) =>
          save.mutate({
            accountId: row.accountId,
            loadingChargePaise: toPaise(v.loadingCharge),
            unloadingChargePaise: toPaise(v.unloadingCharge),
            labourersLoading: v.labourersLoading ?? 0,
            labourersUnloading: v.labourersUnloading ?? 0
          })
        }
      >
        <Form.Item name="loadingCharge" label={t('expenses.loadingCharge')} rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="unloadingCharge" label={t('expenses.unloadingCharge')} rules={[{ required: true }]}>
          <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="labourersLoading" label={t('expenses.labourersLoading')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="labourersUnloading" label={t('expenses.labourersUnloading')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function ExpensesPage(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('expenses.title')}
      </Typography.Title>
      <Tabs
        items={[
          { key: 'salary', label: t('expenses.salary'), children: <SalaryTab /> },
          { key: 'loading', label: t('expenses.loading'), children: <LoadingTab /> }
        ]}
      />
    </div>
  )
}
