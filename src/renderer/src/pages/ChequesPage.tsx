import { useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
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
import AccountSearchSelect from '../components/AccountSearchSelect'

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
  const [open, setOpen] = useState(false)

  // ---- filters ----
  const [fDirection, setFDirection] = useState<'all' | ChequeDirection>('all')
  const [fStatus, setFStatus] = useState<'all' | ChequeStatus>('all')
  const [fParty, setFParty] = useState<number | undefined>()
  const [fBank, setFBank] = useState<number | undefined>()
  const [fNo, setFNo] = useState('')
  const [range, setRange] = useState<[string, string] | undefined>()

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
      setOpen(false)
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

  const bankOptions = (banks.data ?? [])
    .filter((b) => b.name !== 'Cash')
    .map((b) => ({ value: b.id, label: b.name }))

  const filtersActive =
    fDirection !== 'all' || fStatus !== 'all' || fParty != null || fBank != null || fNo.trim() !== '' || !!range
  const clearFilters = (): void => {
    setFDirection('all')
    setFStatus('all')
    setFParty(undefined)
    setFBank(undefined)
    setFNo('')
    setRange(undefined)
  }

  const rows = useMemo(() => {
    const all = (cheques.data ?? []) as ChequeRow[]
    const term = fNo.trim().toLowerCase()
    return all.filter((r) => {
      if (fDirection !== 'all' && r.direction !== fDirection) return false
      if (fStatus !== 'all' && r.status !== fStatus) return false
      if (fParty != null && r.partyAccountId !== fParty) return false
      if (fBank != null && r.bankAccountId !== fBank) return false
      if (term && !r.no.toLowerCase().includes(term)) return false
      if (range && (!r.date || r.date < range[0] || r.date > range[1])) return false
      return true
    })
  }, [cheques.data, fDirection, fStatus, fParty, fBank, fNo, range])

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
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('cheques.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('cheques.new')}
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 130 }}
          value={fDirection}
          onChange={setFDirection}
          options={[
            { value: 'all', label: t('cheques.allDirections') },
            ...(['received', 'given'] as ChequeDirection[]).map((d) => ({
              value: d,
              label: t(`cheques.dir.${d}`)
            }))
          ]}
        />
        <Select
          style={{ width: 130 }}
          value={fStatus}
          onChange={setFStatus}
          options={[
            { value: 'all', label: t('cheques.allStatuses') },
            ...(['pending', 'cleared', 'bounced'] as ChequeStatus[]).map((s) => ({
              value: s,
              label: t(`cheques.st.${s}`)
            }))
          ]}
        />
        <AccountSearchSelect
          showType
          allowClear
          style={{ width: 220 }}
          placeholder={t('cheques.party')}
          value={fParty}
          onChange={setFParty}
        />
        <Select
          allowClear
          style={{ width: 160 }}
          placeholder={t('cheques.bankAccount')}
          value={fBank}
          onChange={(v) => setFBank(v)}
          options={bankOptions}
        />
        <Input
          allowClear
          style={{ width: 140 }}
          placeholder={t('cheques.no')}
          value={fNo}
          onChange={(e) => setFNo(e.target.value)}
        />
        <DatePicker.RangePicker
          format="YYYY-MM-DD"
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(_d, s) => setRange(s[0] && s[1] ? [s[0], s[1]] : undefined)}
        />
        {filtersActive && (
          <Button type="link" onClick={clearFilters}>
            {t('cheques.clearFilters')}
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={cheques.isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 15 }}
      />

      <Modal
        title={t('cheques.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={record.isPending}
        okText={t('common.create')}
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
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
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="direction" label={t('cheques.direction')} rules={[{ required: true }]}>
                <Select
                  options={(['received', 'given'] as ChequeDirection[]).map((d) => ({
                    value: d,
                    label: t(`cheques.dir.${d}`)
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="partyAccountId" label={t('cheques.party')} rules={[{ required: true }]}>
                <AccountSearchSelect showType placeholder={t('cheques.party')} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="bankAccountId" label={t('cheques.bankAccount')} rules={[{ required: true }]}>
                <Select placeholder={t('cheques.bankAccount')} options={bankOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="no" label={t('cheques.no')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank" label={t('cheques.bank')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="date" label={t('common.date')}>
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="clearanceDate" label={t('cheques.clearanceDate')}>
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
