import { useState } from 'react'
import {
  App as AntApp,
  Button,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Statistic,
  Table,
  Typography
} from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { AamadListRow } from '@shared/contracts'
import { DATE_FORMAT, formatDate } from '../lib/format'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useSession } from '../store/session'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

export default function AamadPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const year = useSession((s) => s.session?.year)
  const [kisanFilter, setKisanFilter] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })

  const aamads = useQuery({
    queryKey: ['aamad', kisanFilter, range],
    queryFn: () =>
      window.api.aamad.list({
        kisanAccountId: kisanFilter,
        fromDate: range?.[0],
        toDate: range?.[1]
      })
  })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.aamad.create>[0]) =>
      window.api.aamad.create(input),
    onSuccess: () => {
      message.success(t('aamad.created'))
      setOpen(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['aamad'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.aamad.delete(id),
    onSuccess: () => {
      message.success(t('aamad.deleted'))
      queryClient.invalidateQueries({ queryKey: ['aamad'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const onFinish = (v: {
    serial: number
    date: dayjs.Dayjs
    kisanAccountId: number
    locations: Array<{ room: number; floor: number; rack: number; packets: number }>
  }): void => {
    const locations = (v.locations ?? []).map((l) => ({
      room: l.room,
      floor: l.floor,
      rack: l.rack,
      packets: l.packets
    }))
    const totalPackets = locations.reduce((s, l) => s + (l.packets || 0), 0)
    create.mutate({
      serial: v.serial,
      date: v.date.format('YYYY-MM-DD'),
      kisanAccountId: v.kisanAccountId,
      totalPackets,
      locations
    })
  }

  const rows = (aamads.data?.rows ?? []) as AamadListRow[]
  const { containerRef, rowClassName } = useTableKeyNav(rows, () => {})

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, render: (id: number) => `#${id}` },
    { title: t('aamad.no'), dataIndex: 'no', width: 120 },
    { title: t('common.date'), dataIndex: 'date', width: 120, render: (v: string) => formatDate(v) },
    { title: t('aamad.kisan'), dataIndex: 'kisanName' },
    {
      title: t('aamad.totalPackets'),
      dataIndex: 'totalPackets',
      align: 'right' as const,
      width: 140
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, r: AamadListRow) => (
        <Popconfirm
          title={t('aamad.deleteConfirm')}
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

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('aamad.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('aamad.new')}
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <AccountSearchSelect
          type="kisan"
          allowClear
          style={{ width: 220 }}
          placeholder={t('aamad.kisan')}
          value={kisanFilter}
          onChange={(v) => setKisanFilter(v)}
        />
        <DatePicker.RangePicker
          format={DATE_FORMAT}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
        />
        <Statistic title={t('aamad.count')} value={aamads.data?.count ?? 0} />
        <Statistic title={t('aamad.totalPackets')} value={aamads.data?.totalPackets ?? 0} />
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={aamads.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          rowClassName={rowClassName}
        />
      </div>

      <Modal
        title={t('aamad.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText={t('common.create')}
        width={640}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), locations: [{}] }}
          onFinish={onFinish}
        >
          <Space size="large" wrap>
            <Form.Item
              name="serial"
              label={t('aamad.serial')}
              tooltip={t('aamad.serialHint')}
              rules={[{ required: true }]}
            >
              <InputNumber
                min={1}
                precision={0}
                addonBefore={year ? `${year}-` : undefined}
                style={{ width: 160 }}
              />
            </Form.Item>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_FORMAT} />
            </Form.Item>
            <Form.Item name="kisanAccountId" label={t('aamad.kisan')} rules={[{ required: true }]}>
              <AccountSearchSelect type="kisan" placeholder={t('aamad.kisan')} style={{ width: 220 }} />
            </Form.Item>
          </Space>

          <Typography.Text type="secondary">{t('aamad.location')}</Typography.Text>
          <Form.List name="locations">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" data-pc-row>
                    <Form.Item name={[field.name, 'room']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.room')} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'floor']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.floor')} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'rack']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.rack')} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'packets']} rules={[{ required: true }]}>
                      <InputNumber min={1} placeholder={t('aamad.packets')} style={{ width: 110 }} />
                    </Form.Item>
                    {fields.length > 1 && <DeleteOutlined onClick={() => remove(field.name)} />}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block data-pc-additem>
                  + {t('aamad.addLine')}
                </Button>
              </div>
            )}
          </Form.List>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const locs = (getFieldValue('locations') ?? []) as Array<{ packets?: number }>
              const total = locs.reduce((s, l) => s + (l?.packets || 0), 0)
              return (
                <Typography.Paragraph style={{ marginTop: 8 }}>
                  {t('aamad.totalPackets')}: <strong>{total}</strong>
                </Typography.Paragraph>
              )
            }}
          </Form.Item>
        </Form>
        </div>
      </Modal>
    </div>
  )
}
