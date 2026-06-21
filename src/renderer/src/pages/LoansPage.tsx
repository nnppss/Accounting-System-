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
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { LoanRow } from '@shared/contracts'
import type { LoanCategory, LoanMode } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'

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

  const accounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => window.api.accounts.list({})
  })
  const banks = useQuery({
    queryKey: ['moneybook', 'accounts'],
    queryFn: () => window.api.moneybook.accounts()
  })
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => window.api.loans.list() })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.loans.create>[0]) =>
      window.api.loans.create(input),
    onSuccess: () => {
      message.success(t('loans.created'))
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['loans'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const accountOptions = (accounts.data ?? [])
    .filter((a) => {
      const wanted = category ? CATEGORY_TYPE[category] : null
      return wanted ? a.type === wanted : true
    })
    .map((a) => ({ value: a.id, label: a.name }))
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
      render: (n: string) => (
        <Tag color={n === 'direct' ? 'blue' : 'orange'}>{t(`loans.nature.${n}`)}</Tag>
      )
    },
    {
      title: t('loans.principal'),
      dataIndex: 'principalPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('loans.rate'),
      dataIndex: 'monthlyRateBps',
      align: 'right' as const,
      width: 90,
      render: (bps: number) => `${bps / 100}%`
    },
    {
      title: t('loans.outstanding'),
      dataIndex: 'outstandingPaise',
      align: 'right' as const,
      width: 150,
      render: (v: number) => <strong>{formatINR(v)}</strong>
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 90,
      render: (_: unknown, row: LoanRow) => (
        <Button size="small" onClick={() => setPayLoan(row)} disabled={row.outstandingPaise <= 0}>
          {t('loans.pay')}
        </Button>
      )
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('loans.title')}
      </Typography.Title>

      <Card style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="inline"
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
          <Form.Item name="date" rules={[{ required: true }]}>
            <DatePicker format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="category" rules={[{ required: true }]}>
            <Select
              style={{ width: 120 }}
              options={(['kisan', 'vyapari', 'other'] as LoanCategory[]).map((c) => ({
                value: c,
                label: t(`loans.cat.${c}`)
              }))}
            />
          </Form.Item>
          <Form.Item name="accountId" rules={[{ required: true }]}>
            <Select
              placeholder={t('loans.party')}
              options={accountOptions}
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
            />
          </Form.Item>
          <Form.Item name="amount" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} addonBefore="₹" placeholder={t('common.amount')} />
          </Form.Item>
          <Form.Item name="nature" rules={[{ required: true }]}>
            <Select
              style={{ width: 130 }}
              options={(['direct', 'indirect'] as const).map((n) => ({
                value: n,
                label: t(`loans.nature.${n}`)
              }))}
            />
          </Form.Item>
          <Form.Item name="mode" rules={[{ required: true }]}>
            <Select
              style={{ width: 110 }}
              options={(['cash', 'bank'] as LoanMode[]).map((m) => ({
                value: m,
                label: t(`loans.mode.${m}`)
              }))}
            />
          </Form.Item>
          {mode === 'bank' && (
            <Form.Item name="bankAccountId" rules={[{ required: true }]}>
              <Select placeholder={t('loans.bank')} options={bankOptions} style={{ width: 150 }} />
            </Form.Item>
          )}
          <Form.Item name="rate" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} addonAfter="%/mo" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="mobile">
            <Input placeholder={t('loans.mobile')} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="remark">
            <Input placeholder={t('common.narration')} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={loans.isLoading}
        columns={columns}
        dataSource={(loans.data ?? []) as LoanRow[]}
        pagination={{ pageSize: 15 }}
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
