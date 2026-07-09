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
  Select,
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
import type { LotRemaining, NikasiListRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner } from '../components/report'

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

  // Lots to pick from: on a self-withdrawal only the header kisan's lots; on a sale, all lots.
  const lotFilterKisan = deliveredToType === 'kisan' ? deliveredToAccountId : undefined
  const lots = useQuery({
    queryKey: ['nikasiLots', lotFilterKisan],
    queryFn: () => window.api.nikasi.lots(lotFilterKisan),
    enabled: open
  })
  const lotById = useMemo(() => {
    const m = new Map<number, LotRemaining>()
    for (const l of lots.data ?? []) m.set(l.aamadId, l)
    return m
  }, [lots.data])

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
      queryClient.invalidateQueries({ queryKey: ['nikasiLots'] })
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
      queryClient.invalidateQueries({ queryKey: ['nikasiLots'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  // When a line's lot is picked, pre-fill packets with the whole lot remaining, and (on a sale)
  // its rate from the latest sauda for that lot's kisan. Both are editable afterwards.
  const onValuesChange = async (changed: Record<string, unknown>): Promise<void> => {
    const lines = changed.lines as Array<{ aamadId?: number } | undefined> | undefined
    if (!Array.isArray(lines)) return
    for (let i = 0; i < lines.length; i++) {
      const aamadId = lines[i]?.aamadId
      if (!aamadId) continue
      const lot = lotById.get(aamadId)
      if (!lot) continue
      if (!form.getFieldValue(['lines', i, 'packets'])) {
        form.setFieldValue(['lines', i, 'packets'], lot.remaining)
      }
      if (deliveredToType === 'vyapari' && deliveredToAccountId) {
        const rate = await window.api.sauda.latestRate(deliveredToAccountId, lot.kisanAccountId)
        if (rate !== null && !form.getFieldValue(['lines', i, 'rate'])) {
          form.setFieldValue(['lines', i, 'rate'], paiseToRupees(rate))
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
    lines: Array<{ aamadId: number; packets: number; weightKg?: number; rate?: number }>
  }): void => {
    // Self-withdrawal: the kisan takes his own stock — no sale rate.
    const isSelf = v.deliveredToType === 'kisan'
    create.mutate({
      date: v.date.format('YYYY-MM-DD'),
      deliveredToType: v.deliveredToType,
      deliveredToAccountId: v.deliveredToAccountId,
      vehicleNo: v.vehicleNo,
      receivedBy: v.receivedBy,
      bhadaRecoveredPaise: toPaise(v.bhadaRecovered),
      lines: (v.lines ?? []).map((l) => ({
        aamadId: l.aamadId,
        packets: l.packets,
        weightKg: l.weightKg,
        ratePaise: isSelf ? 0 : toPaise(l.rate)
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
      <PageBanner
        title={t('nikasi.title')}
        extra={
          <Space>
            <Button
              icon={<PrinterOutlined />}
              onClick={() => {
                const parts = [
                  accountFilter ? rows[0]?.deliveredToName : '',
                  typeFilter !== 'all' ? t(`delivery.${typeFilter}`) : '',
                  range ? `${range[0]} → ${range[1]}` : ''
                ].filter(Boolean)
                return print(() => window.api.print.nikasiRegister(parts.join(' · '), rows))
              }}
            >
              {t('common.print')}
            </Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('nikasi.new')}
            </Button>
          </Space>
        }
      />

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
                    <Form.Item name={[field.name, 'aamadId']} rules={[{ required: true }]}>
                      <Select
                        showSearch
                        placeholder={t('nikasi.pickLot')}
                        style={{ width: 300 }}
                        loading={lots.isFetching}
                        notFoundContent={t('nikasi.noStock')}
                        optionFilterProp="label"
                        options={(lots.data ?? []).map((l) => ({
                          value: l.aamadId,
                          label: `${l.lotNo} — ${l.kisanName} — ${l.remaining} ${t('nikasi.leftPkt')}`
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'packets']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('nikasi.packets')} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'weightKg']}>
                      <InputNumber min={0} placeholder={t('nikasi.weight')} style={{ width: 100 }} />
                    </Form.Item>
                    {deliveredToType !== 'kisan' && (
                      <Form.Item name={[field.name, 'rate']} rules={[{ required: true }]}>
                        <InputNumber
                          min={0}
                          precision={2}
                          prefix="₹"
                          placeholder={t('nikasi.rate')}
                          style={{ width: 150 }}
                        />
                      </Form.Item>
                    )}
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
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
              dataSource={detail.data.lines}
              columns={[
                { title: t('aamad.lot'), dataIndex: 'lotNo' },
                { title: t('nikasi.fromKisan'), dataIndex: 'fromKisanName' },
                { title: t('nikasi.packets'), dataIndex: 'packets', align: 'right' as const },
                // Rate/amount only mean something on a vyapari sale.
                ...(detail.data.deliveredToType === 'vyapari'
                  ? [
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
                    ]
                  : [])
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  )
}
