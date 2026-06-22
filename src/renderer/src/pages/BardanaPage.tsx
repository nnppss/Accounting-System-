import {
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Statistic,
  Table,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { BardanaRow } from '@shared/contracts'
import type { BardanaDirection, PaymentMode } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'

export default function BardanaPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const mode = Form.useWatch('mode', form) as PaymentMode | undefined
  const rate = Form.useWatch('rate', form) as number | undefined
  const qty = Form.useWatch('qty', form) as number | undefined

  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => window.api.accounts.list({}) })
  const banks = useQuery({ queryKey: ['moneybook', 'accounts'], queryFn: () => window.api.moneybook.accounts() })
  const list = useQuery({ queryKey: ['bardana'], queryFn: () => window.api.bardana.list() })
  const account = useQuery({ queryKey: ['bardana', 'account'], queryFn: () => window.api.bardana.account() })

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['bardana'] })
  }

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.bardana.create>[0]) =>
      window.api.bardana.create(input),
    onSuccess: () => {
      message.success(t('bardana.created'))
      form.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.bardana.delete(id),
    onSuccess: () => {
      message.success(t('bardana.deleted'))
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['moneybook'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const partyOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  const bankOptions = (banks.data ?? []).filter((b) => b.name !== 'Cash').map((b) => ({ value: b.id, label: b.name }))
  const computedAmount = (rate ?? 0) > 0 && (qty ?? 0) > 0 ? toPaise(rate!) * qty! : 0

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (id: number) => `#${id}` },
    { title: t('common.date'), dataIndex: 'date', width: 110 },
    {
      title: t('bardana.direction'),
      dataIndex: 'direction',
      width: 110,
      render: (d: BardanaDirection) => (
        <Tag color={d === 'issue' ? 'green' : 'blue'}>{t(`bardana.dir.${d}`)}</Tag>
      )
    },
    { title: t('bardana.party'), dataIndex: 'partyName', render: (n: string | null) => n ?? t('common.none') },
    { title: t('bardana.qty'), dataIndex: 'qty', align: 'right' as const, width: 90 },
    {
      title: t('bardana.rate'),
      dataIndex: 'ratePaise',
      align: 'right' as const,
      width: 120,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('bardana.amount'),
      dataIndex: 'amountPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => <strong>{formatINR(v)}</strong>
    },
    {
      title: t('bardana.mode'),
      key: 'mode',
      width: 120,
      render: (_: unknown, r: BardanaRow) => (r.mode === 'bank' ? r.bankName : t('loans.mode.cash'))
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, r: BardanaRow) => (
        <Popconfirm
          title={t('bardana.deleteConfirm')}
          okText={t('common.delete')}
          okButtonProps={{ danger: true }}
          cancelText={t('common.cancel')}
          onConfirm={() => remove.mutate(r.id)}
        >
          <Button size="small" danger type="text">
            {t('common.delete')}
          </Button>
        </Popconfirm>
      )
    }
  ]

  const acct = account.data

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('bardana.title')}
      </Typography.Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title={t('bardana.stockCount')} value={acct?.stockCount ?? 0} suffix={t('bardana.pcs')} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title={t('bardana.totalPurchases')} value={formatINR(acct?.totalPurchasesPaise ?? 0)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title={t('bardana.totalSales')} value={formatINR(acct?.totalSalesPaise ?? 0)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('bardana.profit')}
              value={formatINR(acct?.profitPaise ?? 0)}
              valueStyle={{ color: (acct?.profitPaise ?? 0) >= 0 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="inline"
          initialValues={{ date: dayjs(), direction: 'purchase', mode: 'cash' }}
          onFinish={(v) =>
            create.mutate({
              direction: v.direction,
              date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
              partyAccountId: v.partyAccountId || undefined,
              ratePaise: toPaise(v.rate),
              qty: v.qty,
              mode: v.mode,
              bankAccountId: v.mode === 'bank' ? v.bankAccountId : undefined
            })
          }
        >
          <Form.Item name="direction" rules={[{ required: true }]}>
            <Select
              style={{ width: 130 }}
              options={(['purchase', 'issue'] as BardanaDirection[]).map((d) => ({
                value: d,
                label: t(`bardana.dir.${d}`)
              }))}
            />
          </Form.Item>
          <Form.Item name="date" rules={[{ required: true }]}>
            <DatePicker format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="partyAccountId">
            <Select
              placeholder={t('bardana.party')}
              options={partyOptions}
              showSearch
              optionFilterProp="label"
              allowClear
              style={{ width: 170 }}
            />
          </Form.Item>
          <Form.Item name="qty" rules={[{ required: true }]}>
            <InputNumber min={1} placeholder={t('bardana.qty')} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="rate" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} addonBefore="₹" placeholder={t('bardana.rate')} />
          </Form.Item>
          <Form.Item label={t('bardana.amount')}>
            <Typography.Text strong>{formatINR(computedAmount)}</Typography.Text>
          </Form.Item>
          <Form.Item name="mode" rules={[{ required: true }]}>
            <Select
              style={{ width: 110 }}
              options={(['cash', 'bank'] as PaymentMode[]).map((m) => ({
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
        loading={list.isLoading}
        columns={columns}
        dataSource={(list.data ?? []) as BardanaRow[]}
        pagination={{ pageSize: 15 }}
      />
    </div>
  )
}
