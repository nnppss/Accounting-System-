import { useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
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
import { DATE_FORMAT, formatDate, formatINR, toPaise } from '../lib/format'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

/** How a deal was settled, derived from amount vs paid. */
type SettleMode = 'full' | 'partial' | 'credit'

function payStatusOf(r: BardanaRow): SettleMode {
  const due = r.amountPaise - r.paidPaise
  if (due <= 0) return 'full'
  if (r.paidPaise <= 0) return 'credit'
  return 'partial'
}

export default function BardanaPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })
  const mode = Form.useWatch('mode', form) as PaymentMode | undefined
  const rate = Form.useWatch('rate', form) as number | undefined
  const qty = Form.useWatch('qty', form) as number | undefined
  const settlement = (Form.useWatch('settlement', form) as SettleMode | undefined) ?? 'full'
  const paid = Form.useWatch('paid', form) as number | undefined

  // ---- filters ----
  const [fDirection, setFDirection] = useState<'all' | BardanaDirection>('all')
  const [fMode, setFMode] = useState<'all' | PaymentMode>('all')
  const [fPay, setFPay] = useState<'all' | SettleMode>('all')
  const [fParty, setFParty] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()

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
      setOpen(false)
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

  const bankOptions = (banks.data ?? []).filter((b) => b.name !== 'Cash').map((b) => ({ value: b.id, label: b.name }))
  const computedAmount = (rate ?? 0) > 0 && (qty ?? 0) > 0 ? toPaise(rate!) * qty! : 0
  // What's settled now and what's left, given the chosen settlement mode (drives the modal preview).
  const paidNowPaise =
    settlement === 'full' ? computedAmount : settlement === 'credit' ? 0 : toPaise(paid ?? 0)
  const outstandingPaise = Math.max(0, computedAmount - paidNowPaise)

  const filtersActive =
    fDirection !== 'all' || fMode !== 'all' || fPay !== 'all' || fParty != null || !!range
  const clearFilters = (): void => {
    setFDirection('all')
    setFMode('all')
    setFPay('all')
    setFParty(undefined)
    setRange(undefined)
  }

  const rows = useMemo(() => {
    const all = (list.data ?? []) as BardanaRow[]
    return all.filter((r) => {
      if (fDirection !== 'all' && r.direction !== fDirection) return false
      if (fMode !== 'all' && r.mode !== fMode) return false
      if (fPay !== 'all' && payStatusOf(r) !== fPay) return false
      if (fParty != null && r.partyAccountId !== fParty) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      return true
    })
  }, [list.data, fDirection, fMode, fPay, fParty, range])

  const { containerRef, rowClassName } = useTableKeyNav(rows, () => {})

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (id: number) => `#${id}` },
    { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
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
      title: t('bardana.outstanding'),
      key: 'outstanding',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: BardanaRow) => {
        const status = payStatusOf(r)
        if (status === 'full') return <Tag color="green">{t('bardana.settle.full')}</Tag>
        if (status === 'credit') return <Tag color="red">{t('bardana.settle.credit')}</Tag>
        return <Tag color="orange">{t('bardana.partialDue', { amount: formatINR(r.amountPaise - r.paidPaise) })}</Tag>
      }
    },
    {
      title: t('bardana.mode'),
      key: 'mode',
      width: 120,
      render: (_: unknown, r: BardanaRow) =>
        r.paidPaise <= 0 ? t('common.none') : r.mode === 'bank' ? r.bankName : t('loans.mode.cash')
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
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('bardana.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('bardana.new')}
        </Button>
      </Space>

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

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 150 }}
          value={fDirection}
          onChange={setFDirection}
          options={[
            { value: 'all', label: t('bardana.allDirections') },
            ...(['purchase', 'issue'] as BardanaDirection[]).map((d) => ({
              value: d,
              label: t(`bardana.dir.${d}`)
            }))
          ]}
        />
        <AccountSearchSelect
          showType
          allowClear
          style={{ width: 220 }}
          placeholder={t('bardana.party')}
          value={fParty}
          onChange={setFParty}
        />
        <Select
          style={{ width: 150 }}
          value={fPay}
          onChange={setFPay}
          options={[
            { value: 'all', label: t('bardana.allPayStatus') },
            ...(['full', 'partial', 'credit'] as SettleMode[]).map((s) => ({
              value: s,
              label: t(`bardana.settle.${s}`)
            }))
          ]}
        />
        <Select
          style={{ width: 130 }}
          value={fMode}
          onChange={setFMode}
          options={[
            { value: 'all', label: t('bardana.allModes') },
            ...(['cash', 'bank'] as PaymentMode[]).map((m) => ({
              value: m,
              label: t(`loans.mode.${m}`)
            }))
          ]}
        />
        <DatePicker.RangePicker
          format={DATE_FORMAT}
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
        />
        {filtersActive && (
          <Button type="link" onClick={clearFilters}>
            {t('bardana.clearFilters')}
          </Button>
        )}
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={list.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 15 }}
          rowClassName={rowClassName}
        />
      </div>

      <Modal
        title={t('bardana.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={560}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), direction: 'purchase', mode: 'cash', settlement: 'full' }}
          onFinish={(v) => {
            const amount = toPaise(v.rate) * v.qty
            const settle = v.settlement as SettleMode
            const paidPaise =
              settle === 'full' ? amount : settle === 'credit' ? 0 : toPaise(v.paid ?? 0)
            create.mutate({
              direction: v.direction,
              date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
              partyAccountId: v.partyAccountId || undefined,
              ratePaise: toPaise(v.rate),
              qty: v.qty,
              paidPaise,
              mode: v.mode,
              bankAccountId: settle !== 'credit' && v.mode === 'bank' ? v.bankAccountId : undefined
            })
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="direction" label={t('bardana.direction')} rules={[{ required: true }]}>
                <Select
                  options={(['purchase', 'issue'] as BardanaDirection[]).map((d) => ({
                    value: d,
                    label: t(`bardana.dir.${d}`)
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
                <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="partyAccountId"
            label={t('bardana.party')}
            // The party carries any unpaid balance, so it's mandatory unless paid in full.
            rules={settlement !== 'full' ? [{ required: true, message: t('bardana.partyRequiredCredit') }] : []}
          >
            <AccountSearchSelect showType allowClear placeholder={t('bardana.party')} style={{ width: '100%' }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="qty" label={t('bardana.qty')} rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rate" label={t('bardana.rate')} rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label={t('bardana.amount')}>
                <Typography.Text strong>{formatINR(computedAmount)}</Typography.Text>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={settlement === 'partial' ? 12 : 24}>
              <Form.Item name="settlement" label={t('bardana.settlement')} rules={[{ required: true }]}>
                <Select
                  options={(['full', 'partial', 'credit'] as SettleMode[]).map((s) => ({
                    value: s,
                    label: t(`bardana.settle.${s}`)
                  }))}
                />
              </Form.Item>
            </Col>
            {settlement === 'partial' && (
              <Col span={12}>
                <Form.Item
                  name="paid"
                  label={t('bardana.paidNow')}
                  rules={[
                    { required: true },
                    {
                      validator: (_r, val) =>
                        val != null && toPaise(val) > computedAmount
                          ? Promise.reject(new Error(t('bardana.paidExceedsAmount')))
                          : Promise.resolve()
                    }
                  ]}
                >
                  <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            )}
          </Row>

          {settlement !== 'full' && (
            <Typography.Paragraph type={settlement === 'credit' ? 'danger' : 'warning'} style={{ marginTop: -8 }}>
              {t('bardana.outstanding')}: <strong>{formatINR(outstandingPaise)}</strong>
            </Typography.Paragraph>
          )}

          {settlement !== 'credit' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="mode" label={t('bardana.mode')} rules={[{ required: true }]}>
                  <Select
                    options={(['cash', 'bank'] as PaymentMode[]).map((m) => ({
                      value: m,
                      label: t(`loans.mode.${m}`)
                    }))}
                  />
                </Form.Item>
              </Col>
              {mode === 'bank' && (
                <Col span={12}>
                  <Form.Item name="bankAccountId" label={t('loans.bank')} rules={[{ required: true }]}>
                    <Select placeholder={t('loans.bank')} options={bankOptions} />
                  </Form.Item>
                </Col>
              )}
            </Row>
          )}
        </Form>
        </div>
      </Modal>
    </div>
  )
}
