import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { ChequeRow } from '@shared/contracts'
import type { ChequeDirection, ChequeStatus } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'

const STATUS_COLOR: Record<ChequeStatus, string> = {
  pending: 'gold',
  cleared: 'green',
  bounced: 'red'
}

export default function ChequesPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => window.api.accounts.list({}) })
  const banks = useQuery({ queryKey: ['moneybook', 'accounts'], queryFn: () => window.api.moneybook.accounts() })
  const cheques = useQuery({ queryKey: ['cheques'], queryFn: () => window.api.cheques.list() })

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['cheques'] })
  }

  const record = useMutation({
    mutationFn: (input: Parameters<typeof window.api.cheques.record>[0]) =>
      window.api.cheques.record(input),
    onSuccess: () => {
      message.success(t('cheques.recorded'))
      form.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })
  const clear = useMutation({
    mutationFn: (id: number) => window.api.cheques.clear(id, dayjs().format('YYYY-MM-DD')),
    onSuccess: () => {
      message.success(t('cheques.cleared'))
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })
  const bounce = useMutation({
    mutationFn: (id: number) => window.api.cheques.bounce(id, dayjs().format('YYYY-MM-DD')),
    onSuccess: () => {
      message.success(t('cheques.bounced'))
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const partyOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  const bankOptions = (banks.data ?? []).filter((b) => b.name !== 'Cash').map((b) => ({ value: b.id, label: b.name }))

  const columns = [
    { title: t('cheques.no'), dataIndex: 'no', width: 110 },
    {
      title: t('cheques.direction'),
      dataIndex: 'direction',
      width: 110,
      render: (d: ChequeDirection) => t(`cheques.dir.${d}`)
    },
    { title: t('cheques.party'), dataIndex: 'partyName' },
    { title: t('cheques.bankAccount'), dataIndex: 'bankName' },
    {
      title: t('common.amount'),
      dataIndex: 'amountPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    },
    { title: t('cheques.clearanceDate'), dataIndex: 'clearanceDate', width: 130, render: (d: string | null) => d ?? '—' },
    {
      title: t('cheques.status'),
      dataIndex: 'status',
      width: 100,
      render: (s: ChequeStatus) => <Tag color={STATUS_COLOR[s]}>{t(`cheques.st.${s}`)}</Tag>
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 170,
      render: (_: unknown, row: ChequeRow) =>
        row.status === 'pending' ? (
          <Space>
            <Popconfirm title={t('cheques.confirmClear')} onConfirm={() => clear.mutate(row.id)}>
              <Button size="small" type="primary">
                {t('cheques.clear')}
              </Button>
            </Popconfirm>
            <Popconfirm title={t('cheques.confirmBounce')} onConfirm={() => bounce.mutate(row.id)}>
              <Button size="small" danger>
                {t('cheques.bounce')}
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Typography.Text type="secondary">{t('common.none')}</Typography.Text>
        )
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('cheques.title')}
      </Typography.Title>

      <Card style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="inline"
          initialValues={{ direction: 'received' }}
          onFinish={(v) =>
            record.mutate({
              direction: v.direction,
              partyAccountId: v.partyAccountId,
              bankAccountId: v.bankAccountId,
              amountPaise: toPaise(v.amount),
              no: v.no,
              bank: v.bank || undefined,
              date: v.date ? (v.date as dayjs.Dayjs).format('YYYY-MM-DD') : undefined,
              clearanceDate: v.clearanceDate
                ? (v.clearanceDate as dayjs.Dayjs).format('YYYY-MM-DD')
                : undefined
            })
          }
        >
          <Form.Item name="direction" rules={[{ required: true }]}>
            <Select
              style={{ width: 130 }}
              options={(['received', 'given'] as ChequeDirection[]).map((d) => ({
                value: d,
                label: t(`cheques.dir.${d}`)
              }))}
            />
          </Form.Item>
          <Form.Item name="partyAccountId" rules={[{ required: true }]}>
            <Select
              placeholder={t('cheques.party')}
              options={partyOptions}
              showSearch
              optionFilterProp="label"
              style={{ width: 170 }}
            />
          </Form.Item>
          <Form.Item name="bankAccountId" rules={[{ required: true }]}>
            <Select placeholder={t('cheques.bankAccount')} options={bankOptions} style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="amount" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} addonBefore="₹" placeholder={t('common.amount')} />
          </Form.Item>
          <Form.Item name="no" rules={[{ required: true }]}>
            <Input placeholder={t('cheques.no')} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="bank">
            <Input placeholder={t('cheques.bank')} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="date">
            <DatePicker format="YYYY-MM-DD" placeholder={t('common.date')} />
          </Form.Item>
          <Form.Item name="clearanceDate">
            <DatePicker format="YYYY-MM-DD" placeholder={t('cheques.clearanceDate')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={record.isPending}>
              {t('common.create')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={cheques.isLoading}
        columns={columns}
        dataSource={(cheques.data ?? []) as ChequeRow[]}
        pagination={{ pageSize: 15 }}
      />
    </div>
  )
}
