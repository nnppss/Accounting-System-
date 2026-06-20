import { useState } from 'react'
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
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DeliveryTarget } from '@shared/enums'
import type { NikasiListRow } from '@shared/contracts'
import { formatINR, paiseToRupees, toPaise } from '../lib/format'

export default function NikasiPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [detailId, setDetailId] = useState<number | null>(null)
  const deliveredToType = Form.useWatch('deliveredToType', form) as DeliveryTarget | undefined
  const deliveredToAccountId = Form.useWatch('deliveredToAccountId', form) as number | undefined

  const vyaparis = useQuery({
    queryKey: ['accounts', 'vyapari'],
    queryFn: () => window.api.accounts.list({ type: 'vyapari' })
  })
  const kisans = useQuery({
    queryKey: ['accounts', 'kisan'],
    queryFn: () => window.api.accounts.list({ type: 'kisan' })
  })
  const nikasis = useQuery({ queryKey: ['nikasi'], queryFn: () => window.api.nikasi.list() })
  const detail = useQuery({
    queryKey: ['nikasi', detailId],
    queryFn: () => window.api.nikasi.get(detailId!),
    enabled: detailId !== null
  })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.nikasi.create>[0]) =>
      window.api.nikasi.create(input),
    onSuccess: (r) => {
      message.success(t('nikasi.created', { no: r.billNo }))
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['nikasi'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const kisanOptions = (kisans.data ?? []).map((k) => ({ value: k.id, label: k.name }))
  const vyapariOptions = (vyaparis.data ?? []).map((v) => ({ value: v.id, label: v.name }))
  const deliveredToOptions = deliveredToType === 'vyapari' ? vyapariOptions : kisanOptions

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
    { title: t('nikasi.billNo'), dataIndex: 'billNo', width: 90 },
    { title: t('common.date'), dataIndex: 'date', width: 110 },
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
      title: '',
      key: 'view',
      width: 80,
      render: (_: unknown, r: NikasiListRow) => (
        <Button size="small" onClick={() => setDetailId(r.id)}>
          {t('common.view')}
        </Button>
      )
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('nikasi.title')}
      </Typography.Title>

      <Card style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), deliveredToType: 'vyapari', lines: [{}] }}
          onFinish={onFinish}
          onValuesChange={onValuesChange}
        >
          <Space size="large" align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format="YYYY-MM-DD" />
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
              <Select
                options={deliveredToOptions}
                showSearch
                optionFilterProp="label"
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
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item name={[field.name, 'fromKisanAccountId']} rules={[{ required: true }]}>
                      <Select
                        placeholder={t('nikasi.fromKisan')}
                        options={kisanOptions}
                        showSearch
                        optionFilterProp="label"
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
                        addonBefore="₹"
                        placeholder={t('nikasi.rate')}
                        style={{ width: 130 }}
                      />
                    </Form.Item>
                    {fields.length > 1 && <DeleteOutlined onClick={() => remove(field.name)} />}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block style={{ marginBottom: 12 }}>
                  + {t('nikasi.addLine')}
                </Button>
              </div>
            )}
          </Form.List>

          <Button type="primary" htmlType="submit" loading={create.isPending}>
            {t('common.create')}
          </Button>
        </Form>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={nikasis.isLoading}
        columns={columns}
        dataSource={(nikasis.data ?? []) as NikasiListRow[]}
        pagination={{ pageSize: 15 }}
      />

      <Drawer
        title={detail.data ? `${t('nikasi.billNo')} ${detail.data.billNo}` : ''}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        width={720}
      >
        {detail.data && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('common.date')}>{detail.data.date}</Descriptions.Item>
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
