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
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { DeleteOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DeliveryTarget } from '@shared/enums'
import type { NikasiListRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

export default function NikasiPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })
  const [detailId, setDetailId] = useState<number | null>(null)
  const deliveredToType = Form.useWatch('deliveredToType', form) as DeliveryTarget | undefined
  const deliveredToAccountId = Form.useWatch('deliveredToAccountId', form) as number | undefined

  const [accountFilter, setAccountFilter] = useState<number | undefined>()
  const [typeFilter, setTypeFilter] = useState<'all' | DeliveryTarget>('all')
  const [range, setRange] = useState<[string, string] | undefined>()

  const nikasis = useQuery({ queryKey: ['nikasi'], queryFn: () => window.api.nikasi.list() })
  const detail = useQuery({
    queryKey: ['nikasi', detailId],
    queryFn: () => window.api.nikasi.get(detailId!),
    enabled: detailId !== null
  })

  const rows = useMemo(() => {
    const all = (nikasis.data ?? []) as NikasiListRow[]
    return all.filter((r) => {
      if (accountFilter && r.deliveredToAccountId !== accountFilter) return false
      if (typeFilter !== 'all' && r.deliveredToType !== typeFilter) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      return true
    })
  }, [nikasis.data, accountFilter, typeFilter, range])

  const { containerRef, rowClassName } = useTableKeyNav(rows, (r) => setDetailId(r.id))

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.nikasi.create>[0]) =>
      window.api.nikasi.create(input),
    onSuccess: (r) => {
      message.success(t('nikasi.created', { no: r.billNo }))
      setOpen(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['nikasi'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.nikasi.delete(id),
    onSuccess: () => {
      message.success(t('nikasi.deleted'))
      queryClient.invalidateQueries({ queryKey: ['nikasi'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  // When a line's kisan changes on a vyapari sale, pre-fill its rate from the latest sauda.
  const onValuesChange = async (changed: Record<string, unknown>): Promise<void> => {
    if (deliveredToType !== 'vyapari' || !deliveredToAccountId) return
    const lines = changed.lines as Array<{ fromKisanAccountId?: number } | undefined> | undefined
    if (!Array.isArray(lines)) return
    for (let i = 0; i < lines.length; i++) {
      const kisanId = lines[i]?.fromKisanAccountId
      if (kisanId) {
        const rate = await window.api.sauda.latestRate(deliveredToAccountId, kisanId)
        if (rate !== null) {
          const current = form.getFieldValue(['lines', i, 'rate'])
          if (!current) form.setFieldValue(['lines', i, 'rate'], paiseToRupees(rate))
        }
      }
    }
  }

  const onFinish = (v: {
    date: dayjs.Dayjs
    deliveredToType: DeliveryTarget
    deliveredToAccountId: number
    vehicleNo?: string
    receivedBy?: string
    bhadaRecovered?: number
    lines: Array<{
      fromKisanAccountId: number
      room: number
      floor: number
      rack: number
      packets: number
      weightKg?: number
      rate: number
    }>
  }): void => {
    create.mutate({
      date: v.date.format('YYYY-MM-DD'),
      deliveredToType: v.deliveredToType,
      deliveredToAccountId: v.deliveredToAccountId,
      vehicleNo: v.vehicleNo,
      receivedBy: v.receivedBy,
      bhadaRecoveredPaise: toPaise(v.bhadaRecovered),
      lines: (v.lines ?? []).map((l) => ({
        fromKisanAccountId: l.fromKisanAccountId,
        room: l.room,
        floor: l.floor,
        rack: l.rack,
        packets: l.packets,
        weightKg: l.weightKg,
        ratePaise: toPaise(l.rate)
      }))
    })
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (id: number) => `#${id}` },
    { title: t('nikasi.billNo'), dataIndex: 'billNo', width: 90 },
    { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
    {
      title: t('nikasi.deliveredTo'),
      dataIndex: 'deliveredToName',
      render: (name: string, r: NikasiListRow) => (
        <Space>
          {name}
          <Tag color={r.deliveredToType === 'vyapari' ? 'blue' : 'default'}>
            {t(`delivery.${r.deliveredToType}`)}
          </Tag>
        </Space>
      )
    },
    { title: t('nikasi.packetsCol'), dataIndex: 'totalPackets', align: 'right' as const, width: 100 },
    {
      title: t('nikasi.amount'),
      dataIndex: 'totalAmountPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number, r: NikasiListRow) =>
        r.isPosted ? formatINR(v) : <Typography.Text type="secondary">{formatINR(v)}</Typography.Text>
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 150,
      render: (_: unknown, r: NikasiListRow) => (
        <Space>
          <Button size="small" onClick={() => setDetailId(r.id)}>
            {t('common.view')}
          </Button>
          <Popconfirm
            title={t('nikasi.deleteConfirm')}
            okText={t('common.delete')}
            okButtonProps={{ danger: true }}
            cancelText={t('common.cancel')}
            onConfirm={() => remove.mutate(r.id)}
          >
            <Button size="small" danger type="text">
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('nikasi.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('nikasi.new')}
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <AccountSearchSelect
          allowClear
          style={{ width: 220 }}
          placeholder={t('nikasi.searchAccount')}
          value={accountFilter}
          onChange={(v) => setAccountFilter(v)}
        />
        <Segmented
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as 'all' | DeliveryTarget)}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'vyapari', label: t('delivery.vyapari') },
            { value: 'kisan', label: t('delivery.kisan') }
          ]}
        />
        <DatePicker.RangePicker
          format={DATE_INPUT_FORMATS}
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
        />
        {(accountFilter || typeFilter !== 'all' || range) && (
          <Button
            type="link"
            onClick={() => {
              setAccountFilter(undefined)
              setTypeFilter('all')
              setRange(undefined)
            }}
          >
            {t('nikasi.clearFilters')}
          </Button>
        )}
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={nikasis.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 15 }}
          rowClassName={rowClassName}
          onRow={(r) => ({ onClick: () => setDetailId(r.id), style: { cursor: 'pointer' } })}
        />
      </div>

      <Modal
        title={t('nikasi.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={920}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), deliveredToType: 'vyapari', lines: [{}] }}
          onFinish={onFinish}
          onValuesChange={onValuesChange}
        >
          <Space size="large" align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_INPUT_FORMATS} />
            </Form.Item>
            <Form.Item name="deliveredToType" label={t('nikasi.deliveredTo')}>
              <Segmented
                options={[
                  { value: 'vyapari', label: t('delivery.vyapari') },
                  { value: 'kisan', label: t('delivery.kisan') }
                ]}
              />
            </Form.Item>
            <Form.Item
              name="deliveredToAccountId"
              label={deliveredToType === 'vyapari' ? t('sauda.vyapari') : t('aamad.kisan')}
              rules={[{ required: true }]}
            >
              <AccountSearchSelect
                type={deliveredToType === 'vyapari' ? 'vyapari' : 'kisan'}
                placeholder={deliveredToType === 'vyapari' ? t('sauda.vyapari') : t('aamad.kisan')}
                style={{ width: 200 }}
              />
            </Form.Item>
            <Form.Item name="vehicleNo" label={t('nikasi.vehicle')}>
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="receivedBy" label={t('nikasi.receivedBy')}>
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="bhadaRecovered" label={t('nikasi.bhadaRecovered')}>
              <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: 140 }} />
            </Form.Item>
          </Space>

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap data-pc-row>
                    <Form.Item name={[field.name, 'fromKisanAccountId']} rules={[{ required: true }]}>
                      <AccountSearchSelect
                        type="kisan"
                        placeholder={t('nikasi.fromKisan')}
                        style={{ width: 180 }}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'room']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.room')} style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'floor']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.floor')} style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'rack']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.rack')} style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'packets']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('nikasi.packets')} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'weightKg']}>
                      <InputNumber min={0} placeholder={t('nikasi.weight')} style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'rate']} rules={[{ required: true }]}>
                      <InputNumber
                        min={0}
                        precision={2}
                        prefix="₹"
                        placeholder={t('nikasi.rate')}
                        style={{ width: 150 }}
                      />
                    </Form.Item>
                    {fields.length > 1 && <DeleteOutlined onClick={() => remove(field.name)} />}
                  </Space>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  style={{ marginBottom: 12 }}
                  data-pc-additem
                >
                  + {t('nikasi.addLine')}
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
        </div>
      </Modal>

      <Drawer
        title={detail.data ? `${t('nikasi.billNo')} ${detail.data.billNo}` : ''}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        width={720}
        extra={
          detail.data && (
            <Button
              icon={<PrinterOutlined />}
              onClick={() => print(() => window.api.print.gatePass(detail.data!.id))}
            >
              {t('common.print')}
            </Button>
          )
        }
      >
        {detail.data && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('common.date')}>{formatDate(detail.data.date)}</Descriptions.Item>
              <Descriptions.Item label={t('nikasi.deliveredTo')}>
                {detail.data.deliveredToName} ({t(`delivery.${detail.data.deliveredToType}`)})
              </Descriptions.Item>
              <Descriptions.Item label={t('nikasi.vehicle')}>
                {detail.data.vehicleNo ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('nikasi.receivedBy')}>
                {detail.data.receivedBy ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('nikasi.bhadaRecovered')}>
                {formatINR(detail.data.bhadaRecoveredPaise)}
              </Descriptions.Item>
              <Descriptions.Item label={t('vouchers.no')}>
                {detail.data.voucherNo ?? '—'}
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.data.lines}
              columns={[
                { title: t('nikasi.fromKisan'), dataIndex: 'fromKisanName' },
                {
                  title: t('maps.rack'),
                  key: 'loc',
                  render: (_: unknown, l) => `R${l.room}/F${l.floor}/${l.rack}`
                },
                { title: t('nikasi.packets'), dataIndex: 'packets', align: 'right' as const },
                {
                  title: t('nikasi.rate'),
                  dataIndex: 'ratePaise',
                  align: 'right' as const,
                  render: (v: number) => formatINR(v)
                },
                {
                  title: t('nikasi.amount'),
                  dataIndex: 'amountPaise',
                  align: 'right' as const,
                  render: (v: number) => formatINR(v)
                }
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  )
}
