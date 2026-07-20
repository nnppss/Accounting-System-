import { useMemo, useRef, useState } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  App as AntApp,
  Button,
  DatePicker,
  Form,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { FileExcelOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { SaudaListRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import AccountSearchSelect from '../components/AccountSearchSelect'
import { useCreateHotkey } from '../lib/useHotkeys'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner } from '../components/report'

export default function SaudaPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const [vyapariFilter, setVyapariFilter] = useState<number | undefined>()
  const [kisanFilter, setKisanFilter] = useState<number | undefined>()
  const [range, setRange] = useState<[string, string] | undefined>()
  const [open, setOpen] = useState(false)
  // The deal whose shortfall is being settled (its modal is open).
  const [settling, setSettling] = useState<SaudaListRow | null>(null)
  const [settleForm] = Form.useForm()
  useCreateHotkey(() => setOpen(true))
  // Set by "Save & new" so the success handler clears the form instead of closing it.
  const again = useRef(false)
  const submit = (addAnother: boolean) => (): void => {
    again.current = addAnother
    form.submit()
  }
  const formNav = useFormKeyNav({ open, onAccept: submit(false) })
  const filterNav = useFormKeyNav({ onAccept: () => (document.activeElement as HTMLElement | null)?.blur() })

  // Keep the date — a run of entries is nearly always for the same day.
  const clearForNext = (): void => {
    const date = form.getFieldValue('date')
    form.resetFields()
    form.setFieldValue('date', date)
    formNav.focusFirst()
  }

  const saudas = useQuery({ queryKey: ['sauda'], queryFn: () => window.api.sauda.list() })

  // Lot picker (optional): the selected kisan's aamad lots.
  const kisanId = Form.useWatch('kisanAccountId', form) as number | undefined
  const lots = useQuery({
    queryKey: ['saudaLots', kisanId],
    queryFn: () => window.api.nikasi.lots(kisanId),
    enabled: open && !!kisanId
  })

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
      if (again.current) clearForNext()
      else {
        setOpen(false)
        form.resetFields()
      }
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

  // Settling a shortfall posts money (Dr vyapari / Cr kisan), so it invalidates the ledger reads too.
  const afterSettle = (msg: string) => (): void => {
    message.success(msg)
    setSettling(null)
    queryClient.invalidateQueries({ queryKey: ['sauda'] })
    queryClient.invalidateQueries({ queryKey: ['ledger'] })
    queryClient.invalidateQueries({ queryKey: ['vouchers'] })
  }
  const settle = useMutation({
    mutationFn: (v: { id: number; date: string; amountPaise: number }) =>
      window.api.sauda.settle(v.id, { date: v.date, amountPaise: v.amountPaise }),
    onSuccess: (r) => afterSettle(t('sauda.settled', { amount: formatINR(r.amountPaise) }))(),
    onError: (e: Error) => message.error(e.message)
  })
  const unsettle = useMutation({
    mutationFn: (id: number) => window.api.sauda.unsettle(id),
    onSuccess: afterSettle(t('sauda.unsettled')),
    onError: (e: Error) => message.error(e.message)
  })

  const onFinish = (v: {
    date: dayjs.Dayjs
    vyapariAccountId: number
    kisanAccountId: number
    aamadId?: number
    packets: number
    rate: number
  }): void =>
    create.mutate({
      date: v.date.format('YYYY-MM-DD'),
      vyapariAccountId: v.vyapariAccountId,
      kisanAccountId: v.kisanAccountId,
      aamadId: v.aamadId,
      packets: v.packets,
      ratePaise: toPaise(v.rate)
    })

  // Picking another kisan invalidates the chosen lot.
  const onValuesChange = (changed: Record<string, unknown>): void => {
    if ('kisanAccountId' in changed) form.setFieldValue('aamadId', undefined)
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, render: (id: number) => `#${id}` },
    { title: t('common.date'), dataIndex: 'date', width: 120, render: (v: string) => formatDate(v) },
    {
      title: t('sauda.vyapari'),
      dataIndex: 'vyapariName',
      render: (_: unknown, r: SaudaListRow) => (
        <>
          {r.vyapariName}
          {r.vyapariSonOf && <Typography.Text type="secondary"> s/o {r.vyapariSonOf}</Typography.Text>}
        </>
      )
    },
    {
      title: t('sauda.kisan'),
      dataIndex: 'kisanName',
      render: (_: unknown, r: SaudaListRow) => (
        <>
          {r.kisanName}
          {r.kisanSonOf && <Typography.Text type="secondary"> s/o {r.kisanSonOf}</Typography.Text>}
        </>
      )
    },
    { title: t('sauda.lot'), dataIndex: 'lotNo', width: 110, render: (v: string | null) => v ?? '—' },
    { title: t('sauda.packets'), dataIndex: 'packets', align: 'right' as const, width: 110 },
    {
      title: t('sauda.rate'),
      dataIndex: 'ratePaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    },
    {
      // What he actually took against what he promised — the whole point of the shortfall feature.
      title: t('sauda.lifted'),
      key: 'lifted',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, r: SaudaListRow) =>
        r.shortfallPackets === 0 ? (
          <Tag color="green">{t('sauda.delivered')}</Tag>
        ) : (
          <Tooltip title={t('sauda.shortfallHint', { packets: r.shortfallPackets })}>
            <Tag color={r.settlementVoucherId ? 'blue' : 'orange'}>
              {r.liftedPackets} / {r.packets}
            </Tag>
          </Tooltip>
        )
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 200,
      align: 'center' as const,
      render: (_: unknown, r: SaudaListRow) => (
        <Space size={0}>
          {r.settlementVoucherId !== null ? (
            <Popconfirm
              title={t('sauda.unsettleConfirm', { amount: formatINR(r.settlementPaise ?? 0) })}
              okText={t('sauda.unsettle')}
              cancelText={t('common.cancel')}
              onConfirm={() => unsettle.mutate(r.id)}
            >
              <Button size="small" type="text">
                {t('sauda.settledFor', { amount: formatINR(r.settlementPaise ?? 0) })}
              </Button>
            </Popconfirm>
          ) : (
            r.shortfallPackets > 0 && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setSettling(r)
                  settleForm.setFieldsValue({
                    date: dayjs(),
                    amount:
                      r.suggestedShortfallPaise === null ? undefined : r.suggestedShortfallPaise / 100
                  })
                }}
              >
                {t('sauda.settle')}
              </Button>
            )
          )}
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
        </Space>
      )
    }
  ]

  return (
    <div>
      <PageBanner
        title={t('sauda.title')}
        extra={
          <Space>
            <Button icon={<PrinterOutlined />} onClick={() => print(() => window.api.print.saudaRegister(rows))}>
              {t('common.print')}
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() =>
                exportXlsx(
                  'sauda-register.xlsx',
                  t('sauda.title'),
                  ['Date', 'Vyapari', 'Kisan', 'Lot No', 'Packets', 'Rate', 'Lifted', 'Shortfall'],
                  rows.map((r) => [
                    formatDate(r.date),
                    r.vyapariName,
                    r.kisanName,
                    r.lotNo ?? '',
                    r.packets,
                    paiseToRupees(r.ratePaise),
                    r.liftedPackets,
                    r.shortfallPackets
                  ]),
                  [5] // Rate
                )
              }
            >
              {t('common.excel')}
            </Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('sauda.new')}
            </Button>
          </Space>
        }
      />

      <div ref={filterNav.containerRef} onKeyDownCapture={filterNav.onKeyDownCapture}>
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
      </div>

      <div ref={containerRef}>
        <Table
          rowKey="id"
          size="small"
          loading={saudas.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 20 }}
          rowClassName={rowClassName}
        />
      </div>

      <AutoFocusModal
        title={t('sauda.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit(false)}
        onOkAndNew={submit(true)}
        confirmLoading={create.isPending}
        okText={t('common.create')}
      >
        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form form={form} layout="vertical" initialValues={{ date: dayjs() }} onFinish={onFinish} onValuesChange={onValuesChange}>
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
          <Form.Item name="aamadId" label={t('sauda.lot')}>
            <Select
              allowClear
              showSearch
              disabled={!kisanId}
              loading={lots.isFetching}
              placeholder={t('sauda.pickLot')}
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={(lots.data ?? []).map((l) => ({
                value: l.aamadId,
                label: `${l.lotNo} — ${l.remaining} ${t('nikasi.leftPkt')}`
              }))}
            />
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
      </AutoFocusModal>

      {/* Settle a shortfall. The amount is pre-filled from what the vyapari DID lift on this deal
          (per packet), but it stays editable — the two parties may have agreed something else, and
          when he lifted nothing there is nothing to pre-fill from. */}
      <AutoFocusModal
        title={t('sauda.settleTitle')}
        open={settling !== null}
        onCancel={() => setSettling(null)}
        onOk={() => settleForm.submit()}
        confirmLoading={settle.isPending}
        okText={t('sauda.settle')}
      >
        {settling && (
          <Form
            form={settleForm}
            layout="vertical"
            onFinish={(v: { date: dayjs.Dayjs; amount: number }) =>
              settle.mutate({
                id: settling.id,
                date: v.date.format('YYYY-MM-DD'),
                amountPaise: toPaise(v.amount)
              })
            }
          >
            <Typography.Paragraph type="secondary">
              {t('sauda.settleHint', {
                vyapari: settling.vyapariName,
                kisan: settling.kisanName,
                shortfall: settling.shortfallPackets,
                promised: settling.packets,
                lifted: settling.liftedPackets
              })}
            </Typography.Paragraph>
            {settling.suggestedShortfallPaise === null && (
              <Typography.Paragraph type="warning">{t('sauda.noBasis')}</Typography.Paragraph>
            )}
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_INPUT_FORMATS} />
            </Form.Item>
            <Form.Item name="amount" label={t('sauda.settleAmount')} rules={[{ required: true }]}>
              <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        )}
      </AutoFocusModal>
    </div>
  )
}
