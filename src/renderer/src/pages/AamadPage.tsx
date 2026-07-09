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
  Tag,
  Typography
} from 'antd'
import { DeleteOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { AamadListRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner } from '../components/report'

export default function AamadPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const queryClient = useQueryClient()
  const [kisanFilter, setKisanFilter] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  useCreateHotkey(() => setOpen(true))
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })

  const closeModal = (): void => {
    setOpen(false)
    setEditingId(null)
    form.resetFields()
  }

  const aamads = useQuery({
    queryKey: ['aamad', kisanFilter, range],
    queryFn: () =>
      window.api.aamad.list({
        kisanAccountId: kisanFilter,
        fromDate: range?.[0],
        toDate: range?.[1]
      })
  })

  const save = useMutation({
    mutationFn: async ({
      id,
      input
    }: {
      id: number | null
      input: Parameters<typeof window.api.aamad.create>[0]
    }): Promise<void> => {
      if (id === null) await window.api.aamad.create(input)
      else await window.api.aamad.update(id, input)
    },
    onSuccess: (_data, { id }) => {
      message.success(t(id === null ? 'aamad.created' : 'aamad.updated'))
      closeModal()
      queryClient.invalidateQueries({ queryKey: ['aamad'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const startEdit = async (id: number): Promise<void> => {
    const d = await window.api.aamad.get(id)
    if (!d) return
    form.setFieldsValue({
      date: dayjs(d.date),
      kisanAccountId: d.kisanAccountId,
      totalPackets: d.totalPackets,
      locations: d.locations.map((l) => ({
        room: l.room,
        floor: l.floor,
        rack: l.rack,
        packets: l.packets
      }))
    })
    setEditingId(id)
    setOpen(true)
  }

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
    date: dayjs.Dayjs
    kisanAccountId: number
    totalPackets: number
    locations?: Array<{ room: number; floor: number; rack: number; packets: number }>
  }): void => {
    const locations = (v.locations ?? []).map((l) => ({
      room: l.room,
      floor: l.floor,
      rack: l.rack,
      packets: l.packets
    }))
    save.mutate({
      id: editingId,
      input: {
        date: v.date.format('YYYY-MM-DD'),
        kisanAccountId: v.kisanAccountId,
        totalPackets: v.totalPackets,
        locations
      }
    })
  }

  const rows = (aamads.data?.rows ?? []) as AamadListRow[]
  const { containerRef, rowClassName } = useTableKeyNav(rows, (r) => startEdit(r.id))

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, render: (id: number) => `#${id}` },
    { title: t('aamad.no'), dataIndex: 'no', width: 120 },
    {
      title: t('aamad.lot'),
      key: 'lot',
      width: 110,
      render: (_: unknown, r: AamadListRow) => `${r.no.slice(r.no.indexOf('-') + 1)}/${r.totalPackets}`
    },
    { title: t('common.date'), dataIndex: 'date', width: 120, render: (v: string) => formatDate(v) },
    { title: t('aamad.kisan'), dataIndex: 'kisanName' },
    {
      title: t('aamad.totalPackets'),
      dataIndex: 'totalPackets',
      align: 'right' as const,
      width: 140
    },
    {
      title: t('aamad.unassigned'),
      key: 'unassigned',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, r: AamadListRow) =>
        r.assignedPackets < r.totalPackets ? (
          <Tag color="orange">{r.totalPackets - r.assignedPackets}</Tag>
        ) : null
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 180,
      align: 'center' as const,
      render: (_: unknown, r: AamadListRow) => (
        <>
          <Button
            size="small"
            type="text"
            icon={<PrinterOutlined />}
            onClick={() => print(() => window.api.print.aamadReceipt(r.id))}
          />
          <Button size="small" type="text" onClick={() => startEdit(r.id)}>
            {t('common.edit')}
          </Button>
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
        </>
      )
    }
  ]

  return (
    <div>
      <PageBanner
        title={t('aamad.title')}
        extra={
          <Space>
            <Button
              icon={<PrinterOutlined />}
              onClick={() => {
                const parts = [
                  kisanFilter ? rows[0]?.kisanName : '',
                  range ? `${range[0]} → ${range[1]}` : ''
                ].filter(Boolean)
                return print(() => window.api.print.aamadRegister(parts.join(' · '), rows))
              }}
            >
              {t('common.print')}
            </Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('aamad.new')}
            </Button>
          </Space>
        }
      />

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
          format={DATE_INPUT_FORMATS}
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
        title={t(editingId === null ? 'aamad.new' : 'aamad.edit')}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText={t(editingId === null ? 'common.create' : 'common.save')}
        width={640}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), locations: [] }}
          onFinish={onFinish}
        >
          <Space size="large" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_INPUT_FORMATS} />
            </Form.Item>
            <Form.Item name="kisanAccountId" label={t('aamad.kisan')} rules={[{ required: true }]}>
              <AccountSearchSelect type="kisan" placeholder={t('aamad.kisan')} style={{ width: 220 }} />
            </Form.Item>
            <Form.Item
              name="totalPackets"
              label={t('aamad.totalPackets')}
              tooltip={t('aamad.totalPacketsHint')}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} precision={0} style={{ width: 140 }} />
            </Form.Item>
          </Space>

          <Typography.Text type="secondary">
            {t('aamad.location')} — {t('aamad.locationHint')}
          </Typography.Text>
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
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue }) => {
                        // Empty packets box hints at what's still unplaced (total minus
                        // the other lines), so the next number to type is right there.
                        const total = (getFieldValue('totalPackets') as number) || 0
                        const locs = (getFieldValue('locations') ?? []) as Array<{ packets?: number }>
                        const others = locs.reduce(
                          (s, l, i) => (i === field.name ? s : s + (l?.packets || 0)),
                          0
                        )
                        const remaining = total - others
                        return (
                          <Form.Item name={[field.name, 'packets']} rules={[{ required: true }]}>
                            <InputNumber
                              min={1}
                              placeholder={remaining > 0 ? String(remaining) : t('aamad.packets')}
                              style={{ width: 110 }}
                            />
                          </Form.Item>
                        )
                      }}
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(field.name)} />
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
              const total = (getFieldValue('totalPackets') as number) || 0
              const locs = (getFieldValue('locations') ?? []) as Array<{ packets?: number }>
              const assigned = locs.reduce((s, l) => s + (l?.packets || 0), 0)
              const unassigned = total - assigned
              return (
                <Typography.Paragraph style={{ marginTop: 8 }}>
                  {t('aamad.assigned')}: <strong>{assigned}</strong>
                  {unassigned !== 0 && (
                    <Tag color={unassigned > 0 ? 'orange' : 'red'} style={{ marginLeft: 8 }}>
                      {unassigned > 0
                        ? `${unassigned} ${t('aamad.unassignedLower')}`
                        : `${-unassigned} ${t('aamad.overTotal')}`}
                    </Tag>
                  )}
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
