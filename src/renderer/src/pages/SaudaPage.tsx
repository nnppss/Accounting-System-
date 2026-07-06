import { useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { SaudaListRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, toPaise } from '../lib/format'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

export default function SaudaPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const [vyapariFilter, setVyapariFilter] = useState<number | undefined>()
  const [kisanFilter, setKisanFilter] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()
  const [open, setOpen] = useState(false)
  useCreateHotkey(() => setOpen(true))
  const formNav = useFormKeyNav({ open, onAccept: () => form.submit() })

  const saudas = useQuery({ queryKey: ['sauda'], queryFn: () => window.api.sauda.list() })

  const rows = useMemo(() => {
    const all = (saudas.data ?? []) as SaudaListRow[]
    return all.filter((r) => {
      if (vyapariFilter && r.vyapariAccountId !== vyapariFilter) return false
      if (kisanFilter && r.kisanAccountId !== kisanFilter) return false
      if (range && (r.date < range[0] || r.date > range[1])) return false
      return true
    })
  }, [saudas.data, vyapariFilter, kisanFilter, range])

  const { containerRef, rowClassName } = useTableKeyNav(rows, () => {})

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.sauda.create>[0]) =>
      window.api.sauda.create(input),
    onSuccess: () => {
      message.success(t('sauda.created'))
      setOpen(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['sauda'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.sauda.delete(id),
    onSuccess: () => {
      message.success(t('sauda.deleted'))
      queryClient.invalidateQueries({ queryKey: ['sauda'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const onFinish = (v: {
    date: dayjs.Dayjs
    vyapariAccountId: number
    kisanAccountId: number
    packets: number
    rate: number
  }): void =>
    create.mutate({
      date: v.date.format('YYYY-MM-DD'),
      vyapariAccountId: v.vyapariAccountId,
      kisanAccountId: v.kisanAccountId,
      packets: v.packets,
      ratePaise: toPaise(v.rate)
    })

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, render: (id: number) => `#${id}` },
    { title: t('common.date'), dataIndex: 'date', width: 120, render: (v: string) => formatDate(v) },
    { title: t('sauda.vyapari'), dataIndex: 'vyapariName' },
    { title: t('sauda.kisan'), dataIndex: 'kisanName' },
    { title: t('sauda.packets'), dataIndex: 'packets', align: 'right' as const, width: 110 },
    {
      title: t('sauda.rate'),
      dataIndex: 'ratePaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, r: SaudaListRow) => (
        <Popconfirm
          title={t('sauda.deleteConfirm')}
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
          {t('sauda.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t('sauda.new')}
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }} wrap>
        <AccountSearchSelect
          type="vyapari"
          allowClear
          style={{ width: 220 }}
          placeholder={t('sauda.vyapari')}
          value={vyapariFilter}
          onChange={(v) => setVyapariFilter(v)}
        />
        <AccountSearchSelect
          type="kisan"
          allowClear
          style={{ width: 220 }}
          placeholder={t('sauda.kisan')}
          value={kisanFilter}
          onChange={(v) => setKisanFilter(v)}
        />
        <DatePicker.RangePicker
          format={DATE_INPUT_FORMATS}
          onChange={(d) => setRange(d?.[0] && d?.[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : undefined)}
        />
        {(vyapariFilter || kisanFilter || range) && (
          <Button
            type="link"
            onClick={() => {
              setVyapariFilter(undefined)
              setKisanFilter(undefined)
              setRange(undefined)
            }}
          >
            {t('sauda.clearFilters')}
          </Button>
        )}
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={saudas.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          rowClassName={rowClassName}
        />
      </div>

      <Modal
        title={t('sauda.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText={t('common.create')}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form form={form} layout="vertical" initialValues={{ date: dayjs() }} onFinish={onFinish}>
          <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
            <DatePicker format={DATE_INPUT_FORMATS} />
          </Form.Item>
          <Form.Item
            name="vyapariAccountId"
            label={t('sauda.vyapari')}
            rules={[{ required: true }]}
          >
            <AccountSearchSelect type="vyapari" placeholder={t('sauda.vyapari')} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="kisanAccountId" label={t('sauda.kisan')} rules={[{ required: true }]}>
            <AccountSearchSelect type="kisan" placeholder={t('sauda.kisan')} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="packets" label={t('sauda.packets')} rules={[{ required: true }]}>
            <InputNumber min={1} placeholder={t('sauda.packets')} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="rate" label={t('sauda.rate')} rules={[{ required: true }]}>
            <InputNumber
              min={0}
              precision={2}
              addonBefore="₹"
              placeholder={t('sauda.rate')}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
        </div>
      </Modal>
    </div>
  )
}
