import { useMemo, useRef, useState } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { DeleteOutlined, FileExcelOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DeliveryTarget } from '@shared/enums'
import type { LotRemaining, NikasiListRow, NikasiWeighmentView } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { titleCase } from '../components/SuggestInput'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner, SectionBar } from '../components/report'

/** Weights are whole kilos off the gate scale — group the digits, don't decimalise them. */
const kg = (v: number): string => (v ? v.toLocaleString('en-IN') : '—')

interface KisanRoll {
  fromKisanAccountId: number
  fromKisanName: string
  weighings: number
  packets: number
  weightKg: number
  amountPaise: number
}

/**
 * Roll a gate pass's weighings up per kisan. A kisan can be weighed more than once on one truck —
 * ordinary stock at one rate, a variety lot at another — but he is credited once, so this is the
 * figure his ledger carries. Insertion order, so it reads in the order the truck was loaded.
 */
function perKisan(weighments: NikasiWeighmentView[]): KisanRoll[] {
  const by = new Map<number, KisanRoll>()
  for (const w of weighments) {
    const r = by.get(w.fromKisanAccountId) ?? {
      fromKisanAccountId: w.fromKisanAccountId,
      fromKisanName: w.fromKisanName,
      weighings: 0,
      packets: 0,
      weightKg: 0,
      amountPaise: 0
    }
    r.weighings += 1
    r.packets += w.packets
    r.weightKg += w.weightKg
    r.amountPaise += w.amountPaise
    by.set(w.fromKisanAccountId, r)
  }
  return [...by.values()]
}

export default function NikasiPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
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
  const [detailId, setDetailId] = useState<number | null>(null)

  // Keep the date — a run of entries is nearly always for the same day.
  const clearForNext = (): void => {
    const date = form.getFieldValue('date')
    form.resetFields()
    form.setFieldValue('date', date)
    formNav.focusFirst()
  }
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
      if (again.current) clearForNext()
      else {
        setOpen(false)
        form.resetFields()
      }
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

  // When a lot is picked, pre-fill its packets with what's actually shippable, and (on a sale) the
  // weighing's rate off the sauda these packets will settle against — the pair's oldest deal with
  // packets still outstanding (see sauda.ts rateForLifting). Both are editable afterwards. A lot
  // booked by total but never placed has nothing to ship, so say so here rather than let the save
  // fail. The rate hangs off the weighing, not the lot — every lot on one scale shares it.
  const onValuesChange = async (changed: Record<string, unknown>): Promise<void> => {
    const weighments = changed.weighments as
      | Array<{ lots?: Array<{ aamadId?: number } | undefined> } | undefined>
      | undefined
    if (!Array.isArray(weighments)) return
    for (let wi = 0; wi < weighments.length; wi++) {
      const lotsChanged = weighments[wi]?.lots
      if (!Array.isArray(lotsChanged)) continue
      for (let li = 0; li < lotsChanged.length; li++) {
        const aamadId = lotsChanged[li]?.aamadId
        if (!aamadId) continue
        const lot = lotById.get(aamadId)
        if (!lot) continue
        if (lot.inRacks <= 0) {
          message.warning(t('nikasi.lotNotPlaced', { lot: lot.lotNo }))
        } else if (!form.getFieldValue(['weighments', wi, 'lots', li, 'packets'])) {
          form.setFieldValue(['weighments', wi, 'lots', li, 'packets'], lot.inRacks)
        }
        if (deliveredToType === 'vyapari' && deliveredToAccountId) {
          const rate = await window.api.sauda.rateForLifting(deliveredToAccountId, lot.kisanAccountId)
          if (rate !== null && !form.getFieldValue(['weighments', wi, 'rate'])) {
            form.setFieldValue(['weighments', wi, 'rate'], paiseToRupees(rate))
          }
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
    remark?: string
    weighments: Array<{
      weightKg?: number
      rate?: number
      lots: Array<{ aamadId: number; packets: number }>
    }>
  }): void => {
    // Self-withdrawal: the kisan takes his own stock — no sale rate.
    const isSelf = v.deliveredToType === 'kisan'
    // A weighing is ONE kisan's scale reading. Two kisans' lots in one weighing can't be honoured —
    // the service keys weighings by (kisan, rate), so it would split them and hand the whole
    // reading to whichever kisan came first, crediting him for the other's potatoes. Refuse it
    // here, where the lots' owners are known.
    for (let i = 0; i < (v.weighments ?? []).length; i++) {
      const owners = new Set(
        (v.weighments[i].lots ?? []).map((l) => lotById.get(l.aamadId)?.kisanAccountId)
      )
      if (owners.size > 1) {
        message.error(t('nikasi.oneKisanPerWeighing', { no: i + 1 }))
        return
      }
    }
    // One weighing → one line per lot, all at its rate, with the single scale reading on the first.
    // The service regroups them by (kisan, rate) and sums the weight back — see NikasiLineInput.
    create.mutate({
      date: v.date.format('YYYY-MM-DD'),
      deliveredToType: v.deliveredToType,
      deliveredToAccountId: v.deliveredToAccountId,
      vehicleNo: v.vehicleNo,
      receivedBy: v.receivedBy,
      bhadaRecoveredPaise: toPaise(v.bhadaRecovered),
      remark: v.remark,
      lines: (v.weighments ?? []).flatMap((w) =>
        (w.lots ?? []).map((l, i) => ({
          aamadId: l.aamadId,
          packets: l.packets,
          weightKg: i === 0 ? w.weightKg : undefined,
          ratePaise: isSelf ? 0 : toPaise(w.rate)
        }))
      )
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
          <span>
            {name}
            {r.deliveredToSonOf && (
              <Typography.Text type="secondary"> s/o {r.deliveredToSonOf}</Typography.Text>
            )}
          </span>
          <Tag color={r.deliveredToType === 'vyapari' ? 'blue' : 'default'}>
            {t(`delivery.${r.deliveredToType}`)}
          </Tag>
        </Space>
      )
    },
    { title: t('nikasi.packetsCol'), dataIndex: 'totalPackets', align: 'right' as const, width: 100 },
    {
      title: t('nikasi.weight'),
      dataIndex: 'totalWeightKg',
      align: 'right' as const,
      width: 110,
      render: kg
    },
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
            <Button
              icon={<FileExcelOutlined />}
              onClick={() =>
                exportXlsx(
                  'nikasi-register.xlsx',
                  t('nikasi.title'),
                  ['Bill No', 'Date', 'Delivered To', 'Vehicle', 'Packets', 'Weight (kg)', 'Amount'],
                  rows.map((r) => [
                    r.billNo,
                    formatDate(r.date),
                    r.deliveredToName,
                    r.vehicleNo ?? '',
                    r.totalPackets,
                    r.totalWeightKg,
                    paiseToRupees(r.totalAmountPaise)
                  ]),
                  [6] // Amount
                )
              }
            >
              {t('common.excel')}
            </Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('nikasi.new')}
            </Button>
          </Space>
        }
      />

      <div ref={filterNav.containerRef} onKeyDownCapture={filterNav.onKeyDownCapture}>
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
      </div>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={nikasis.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 15 }}
          rowClassName={rowClassName}
          onRow={(r) => ({ onClick: () => setDetailId(r.id), style: { cursor: 'pointer' } })}
        />
      </div>

      <AutoFocusModal
        title={t('nikasi.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit(false)}
        onOkAndNew={submit(true)}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={920}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), deliveredToType: 'vyapari', weighments: [{ lots: [{}] }] }}
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
            <Form.Item
              name="receivedBy"
              label={t('nikasi.receivedBy')}
              getValueFromEvent={(e) => titleCase(e.target.value)}
            >
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="bhadaRecovered" label={t('nikasi.bhadaRecovered')}>
              <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: 140 }} />
            </Form.Item>
            {/* Where "15 of the 115 were spoilt, so only 100 were weighed" goes — the money is
                weight-driven, so without this the packet/weight gap reads as a weighing error. */}
            <Form.Item name="remark" label={t('nikasi.remark')}>
              <Input style={{ width: 280 }} placeholder={t('nikasi.remarkHint')} />
            </Form.Item>
          </Space>

          {/* One card per weighing: the lots that shared the scale, then the ONE weight and rate
              they were sold at. A kisan gets a second card when he sold at a second rate. */}
          <Form.List name="weighments">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field, wi) => (
                  <Card
                    key={field.key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={t('nikasi.weighingNo', { no: wi + 1 })}
                    extra={
                      fields.length > 1 && (
                        <DeleteOutlined onClick={() => remove(field.name)} />
                      )
                    }
                  >
                    <Form.List name={[field.name, 'lots']}>
                      {(lotFields, lotOps) => (
                        <div>
                          {lotFields.map((lf) => (
                            <Space key={lf.key} align="baseline" wrap data-pc-row>
                              <Form.Item name={[lf.name, 'aamadId']} rules={[{ required: true }]}>
                                <Select
                                  showSearch
                                  placeholder={t('nikasi.pickLot')}
                                  style={{ width: 300 }}
                                  loading={lots.isFetching}
                                  notFoundContent={t('nikasi.noStock')}
                                  optionFilterProp="label"
                                  options={(lots.data ?? []).map((l) => ({
                                    value: l.aamadId,
                                    label:
                                      l.inRacks === l.remaining
                                        ? `${l.lotNo} — ${l.kisanName} — ${l.remaining} ${t('nikasi.leftPkt')}`
                                        : `${l.lotNo} — ${l.kisanName} — ${l.remaining} ${t('nikasi.leftPkt')}, ${l.inRacks} ${t('nikasi.inRacks')}`
                                  }))}
                                />
                              </Form.Item>
                              <Form.Item name={[lf.name, 'packets']} rules={[{ required: true }]}>
                                <InputNumber
                                  min={1}
                                  placeholder={t('nikasi.packets')}
                                  style={{ width: 90 }}
                                />
                              </Form.Item>
                              {lotFields.length > 1 && (
                                <DeleteOutlined onClick={() => lotOps.remove(lf.name)} />
                              )}
                            </Space>
                          ))}
                          <Button
                            type="dashed"
                            size="small"
                            onClick={() => lotOps.add()}
                            block
                            style={{ marginBottom: 12 }}
                            data-pc-additem
                          >
                            + {t('nikasi.addLot')}
                          </Button>
                        </div>
                      )}
                    </Form.List>
                    <Space align="baseline" wrap>
                      <Form.Item
                        name={[field.name, 'weightKg']}
                        label={t('nikasi.weighedTogether')}
                        rules={[{ required: deliveredToType !== 'kisan' }]}
                      >
                        <InputNumber
                          min={0}
                          placeholder={t('nikasi.weight')}
                          style={{ width: 140 }}
                        />
                      </Form.Item>
                      {deliveredToType !== 'kisan' && (
                        <Form.Item
                          name={[field.name, 'rate']}
                          label={t('nikasi.rate')}
                          rules={[{ required: true }]}
                        >
                          <InputNumber min={0} precision={2} prefix="₹" style={{ width: 150 }} />
                        </Form.Item>
                      )}
                    </Space>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ lots: [{}] })}
                  block
                  style={{ marginBottom: 12 }}
                >
                  + {t('nikasi.addWeighing')}
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
        </div>
      </AutoFocusModal>

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
              <Descriptions.Item label={t('nikasi.totalWeight')}>
                {kg(detail.data.totalWeightKg)}
              </Descriptions.Item>
              <Descriptions.Item label={t('nikasi.remark')} span={2}>
                {detail.data.remark ?? '—'}
              </Descriptions.Item>
            </Descriptions>

            {/* One truck carries lots from several kisans, each weighed and priced on its own deal.
                This rolls the lots up per kisan — what each kisan is owed for his share of the load
                — before the lot-by-lot detail below. */}
            <SectionBar>{t('nikasi.byKisan')}</SectionBar>
            <Table
              className="pc-report"
              rowKey="fromKisanAccountId"
              size="small"
              pagination={false}
              style={{ marginBottom: 16 }}
              dataSource={perKisan(detail.data.weighments)}
              columns={[
                { title: t('nikasi.fromKisan'), dataIndex: 'fromKisanName' },
                { title: t('nikasi.weighings'), dataIndex: 'weighings', align: 'right' as const },
                { title: t('nikasi.packets'), dataIndex: 'packets', align: 'right' as const },
                {
                  title: t('nikasi.weight'),
                  dataIndex: 'weightKg',
                  align: 'right' as const,
                  render: kg
                },
                ...(detail.data.deliveredToType === 'vyapari'
                  ? [
                      {
                        title: t('nikasi.amount'),
                        dataIndex: 'amountPaise',
                        align: 'right' as const,
                        render: (v: number) => formatINR(v)
                      }
                    ]
                  : [])
              ]}
              summary={(rows) => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2} align="right">
                    <strong>{t('common.total')}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <strong>{rows.reduce((s, r) => s + r.packets, 0)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <strong>{kg(rows.reduce((s, r) => s + r.weightKg, 0))}</strong>
                  </Table.Summary.Cell>
                  {detail.data!.deliveredToType === 'vyapari' && (
                    <Table.Summary.Cell index={4} align="right">
                      <strong>{formatINR(rows.reduce((s, r) => s + r.amountPaise, 0))}</strong>
                    </Table.Summary.Cell>
                  )}
                </Table.Summary.Row>
              )}
            />

            {/* A row per weighing — what the scale and the deal actually produced. Lots that went
                over together are named together against the one weight and rate. */}
            <SectionBar>{t('nikasi.weighingDetail')}</SectionBar>
            <Table
              className="pc-report"
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
              dataSource={detail.data.weighments}
              columns={[
                { title: t('nikasi.fromKisan'), dataIndex: 'fromKisanName' },
                {
                  title: t('nikasi.lots'),
                  key: 'lots',
                  render: (_: unknown, w: NikasiWeighmentView) =>
                    w.lots.map((l) => `${l.lotNo} (${l.packets})`).join(' + ')
                },
                { title: t('nikasi.packets'), dataIndex: 'packets', align: 'right' as const },
                {
                  title: t('nikasi.weight'),
                  dataIndex: 'weightKg',
                  align: 'right' as const,
                  render: kg
                },
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
