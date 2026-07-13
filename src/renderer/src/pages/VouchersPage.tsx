import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag
} from 'antd'
import { DeleteOutlined, PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { PageBanner, SectionBar } from '../components/report'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { VoucherListRow } from '@shared/contracts'
import type { EntryTag, VoucherType } from '@shared/enums'
import { DATE_INPUT_FORMATS, formatDate, formatINR, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'

type Mode = 'receipt' | 'payment' | 'contra' | 'journal'

export default function VouchersPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const print = usePrinter()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('receipt')
  const [voidTarget, setVoidTarget] = useState<VoucherListRow | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [form] = Form.useForm()
  const method = Form.useWatch('method', form)
  const formNav = useFormKeyNav({ onAccept: () => form.submit() })
  const location = useLocation()

  // Quick-entry (Ctrl+K) lands here with the chosen mode; switch to it and focus the first field
  // so the accountant can start typing without touching the type switcher.
  useEffect(() => {
    const m = (location.state as { voucherMode?: Mode } | null)?.voucherMode
    if (!m) return
    setMode(m)
    form.resetFields()
    requestAnimationFrame(() =>
      formNav.containerRef.current
        ?.querySelector<HTMLElement>('input, textarea, [tabindex]')
        ?.focus()
    )
  }, [location])

  const parties = useQuery({ queryKey: ['accounts', 'parties'], queryFn: () => window.api.accounts.list({}) })
  const allAccounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => window.api.accounts.list({ includeSystem: true })
  })
  const cashBanks = useQuery({ queryKey: ['cashbanks'], queryFn: () => window.api.moneybook.accounts() })
  const vouchers = useQuery({ queryKey: ['vouchers'], queryFn: () => window.api.vouchers.list() })

  // String labels (not nodes) so optionFilterProp="label" keeps matching — and the
  // s/o suffix makes same-named parties both distinguishable and searchable by father.
  const partyLabel = (a: { name: string; personSonOf: string | null }): string =>
    a.personSonOf ? `${a.name} s/o ${a.personSonOf}` : a.name
  const partyOptions = (parties.data ?? []).map((a) => ({ value: a.id, label: partyLabel(a) }))
  const allOptions = (allAccounts.data ?? []).map((a) => ({ value: a.id, label: partyLabel(a) }))
  const cashOptions = (cashBanks.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  // Cheques always clear into a bank, never Cash.
  const bankOptions = (cashBanks.data ?? []).filter((a) => a.name !== 'Cash').map((a) => ({ value: a.id, label: a.name }))
  // 'opening' is a close-year artifact, not something entered by hand.
  const tagOptions = (['general', 'rent', 'loan', 'interest', 'trade'] as const).map((v) => ({
    value: v,
    label: t(`tag.${v}`)
  }))

  const onPosted = (no: number): void => {
    message.success(t('vouchers.posted', { no }))
    form.resetFields()
    queryClient.invalidateQueries({ queryKey: ['vouchers'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }
  const onError = (e: Error): void => {
    message.error(e.message)
  }

  const post = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const date = (values.date as dayjs.Dayjs).format('YYYY-MM-DD')
      const narration = values.narration as string | undefined
      if (mode === 'receipt' || mode === 'payment') {
        // Paid/received by cheque → record a pending cheque (direction follows the voucher type);
        // the accountant clears/bounces it later from the Cheques page.
        if (values.method === 'cheque') {
          const received = mode === 'receipt'
          return window.api.cheques.record({
            direction: received ? 'received' : 'given',
            partyAccountId: values.partyAccountId as number,
            bankAccountId: values.cashBankAccountId as number,
            amountPaise: toPaise(values.amount as number),
            no: values.no as string,
            bank: (values.bank as string) || undefined,
            date: received ? undefined : date,
            receiveDate: received ? date : undefined
          })
        }
        const fn = mode === 'receipt' ? window.api.vouchers.receipt : window.api.vouchers.payment
        return fn({
          date,
          narration,
          partyAccountId: values.partyAccountId as number,
          cashBankAccountId: values.cashBankAccountId as number,
          amountPaise: toPaise(values.amount as number),
          tag: values.tag as EntryTag | undefined
        })
      }
      if (mode === 'contra') {
        return window.api.vouchers.contra({
          date,
          narration,
          fromAccountId: values.fromAccountId as number,
          toAccountId: values.toAccountId as number,
          amountPaise: toPaise(values.amount as number)
        })
      }
      const lines =
        (values.lines as Array<{ accountId: number; dr?: number; cr?: number; tag?: EntryTag }>) ?? []
      return window.api.vouchers.journal({
        date,
        narration,
        entries: lines.map((l) => ({
          accountId: l.accountId,
          drPaise: toPaise(l.dr),
          crPaise: toPaise(l.cr),
          tag: l.tag
        }))
      })
    },
    onSuccess: (r) => {
      // A recorded cheque has no voucher number; a posted voucher does.
      if ('voucherNo' in r) {
        onPosted(r.voucherNo)
        return
      }
      message.success(t('cheques.recorded'))
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['vouchers'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['cheques'] })
    },
    onError
  })

  const voidMut = useMutation({
    mutationFn: (v: { id: number; reason: string }) => window.api.vouchers.void(v.id, v.reason),
    onSuccess: () => {
      message.success(t('vouchers.voided'))
      setVoidTarget(null)
      setVoidReason('')
      queryClient.invalidateQueries({ queryKey: ['vouchers'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError
  })

  const { containerRef, rowClassName } = useTableKeyNav(vouchers.data, (r) =>
    print(() => window.api.print.voucher(r.id))
  )

  const columns = [
    { title: t('vouchers.no'), dataIndex: 'no', width: 70 },
    {
      title: t('vouchers.type'),
      dataIndex: 'type',
      width: 110,
      render: (ty: VoucherType, r: VoucherListRow) => (
        <Space>
          {t(`vouchers.${ty}`)}
          {r.isAuto && <Tag color="blue">auto</Tag>}
        </Space>
      )
    },
    { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
    {
      title: t('common.narration'),
      dataIndex: 'narration',
      render: (n: string | null, r: VoucherListRow) => (
        <>
          {n ?? '—'}
          {r.tags.map((tag) => (
            <Tag key={tag} color="purple" style={{ marginLeft: 8 }}>
              {t(`tag.${tag}`)}
            </Tag>
          ))}
        </>
      )
    },
    {
      title: t('common.total'),
      dataIndex: 'totalPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      render: (_: unknown, r: VoucherListRow) => (
        <Space>
          <Button
            size="small"
            icon={<PrinterOutlined />}
            onClick={() => print(() => window.api.print.voucher(r.id))}
          />
          {/* Auto (module-raised) vouchers are reversed from their own screen, not here. */}
          {!r.isAuto && (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              title={t('vouchers.void')}
              onClick={() => {
                setVoidReason('')
                setVoidTarget(r)
              }}
            />
          )}
        </Space>
      )
    }
  ]

  return (
    <div>
      <PageBanner title={t('vouchers.title')} />

      <Card style={{ marginBottom: 24, maxWidth: 720 }}>
        <Segmented
          block
          value={mode}
          onChange={(v) => {
            setMode(v as Mode)
            form.resetFields()
          }}
          options={[
            { value: 'receipt', label: t('vouchers.receipt') },
            { value: 'payment', label: t('vouchers.payment') },
            { value: 'contra', label: t('vouchers.contra') },
            { value: 'journal', label: t('vouchers.journal') }
          ]}
          style={{ marginBottom: 16 }}
        />

        <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), method: 'direct', lines: [{}, {}] }}
          onFinish={(v) => post.mutate(v)}
        >
          <Space size="large" style={{ display: 'flex' }} align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format={DATE_INPUT_FORMATS} />
            </Form.Item>
            {mode !== 'journal' && (
              <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: 200 }} />
              </Form.Item>
            )}
          </Space>

          {(mode === 'receipt' || mode === 'payment') && (
            <>
              <Form.Item name="method" label={t('vouchers.method')} rules={[{ required: true }]}>
                <Select
                  style={{ width: 200 }}
                  options={[
                    { value: 'direct', label: t('vouchers.cashBank') },
                    { value: 'cheque', label: t('cheques.title') }
                  ]}
                />
              </Form.Item>
              <Form.Item name="partyAccountId" label={t('vouchers.party')} rules={[{ required: true }]}>
                <Select options={partyOptions} showSearch optionFilterProp="label" />
              </Form.Item>
              {method === 'cheque' ? (
                <>
                  <Form.Item
                    name="cashBankAccountId"
                    label={t('cheques.bankAccount')}
                    rules={[{ required: true }]}
                    preserve={false}
                  >
                    <Select options={bankOptions} showSearch optionFilterProp="label" />
                  </Form.Item>
                  <Space size="large" wrap>
                    <Form.Item name="no" label={t('cheques.no')} rules={[{ required: true }]}>
                      <Input style={{ width: 160 }} />
                    </Form.Item>
                    {/* Drawee bank = the party's own bank, only meaningful on a cheque we receive.
                        On a cheque we issue, the drawee is our own bank account selected above. */}
                    {mode === 'receipt' && (
                      <Form.Item name="bank" label={t('cheques.bank')}>
                        <Input style={{ width: 200 }} />
                      </Form.Item>
                    )}
                  </Space>
                </>
              ) : (
                <>
                  <Form.Item
                    name="cashBankAccountId"
                    label={t('vouchers.cashBank')}
                    rules={[{ required: true }]}
                    preserve={false}
                  >
                    <Select options={cashOptions} showSearch optionFilterProp="label" />
                  </Form.Item>
                  <Form.Item name="tag" label={t('vouchers.tag')}>
                    <Select options={tagOptions} allowClear placeholder={t('tag.general')} />
                  </Form.Item>
                </>
              )}
            </>
          )}

          {mode === 'contra' && (
            <>
              <Form.Item name="fromAccountId" label={t('vouchers.from')} rules={[{ required: true }]}>
                <Select options={cashOptions} showSearch optionFilterProp="label" />
              </Form.Item>
              <Form.Item name="toAccountId" label={t('vouchers.to')} rules={[{ required: true }]}>
                <Select options={cashOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            </>
          )}

          {mode === 'journal' && (
            <Form.List
              name="lines"
              rules={[
                {
                  validator: async (_, lines) => {
                    const arr = (lines as Array<{ dr?: number; cr?: number }>) ?? []
                    const dr = arr.reduce((s, l) => s + toPaise(l?.dr), 0)
                    const cr = arr.reduce((s, l) => s + toPaise(l?.cr), 0)
                    if (arr.length < 2 || dr !== cr || dr === 0) {
                      return Promise.reject(new Error(t('vouchers.unbalanced')))
                    }
                  }
                }
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }} data-pc-row>
                      <Form.Item
                        name={[field.name, 'accountId']}
                        rules={[{ required: true }]}
                        style={{ width: 280 }}
                      >
                        <Select
                          placeholder={t('vouchers.account')}
                          options={allOptions}
                          showSearch
                          optionFilterProp="label"
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'dr']}>
                        <InputNumber min={0} precision={2} placeholder={t('common.dr')} addonBefore="₹" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'cr']}>
                        <InputNumber min={0} precision={2} placeholder={t('common.cr')} addonBefore="₹" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'tag']} style={{ width: 130 }}>
                        <Select options={tagOptions} allowClear placeholder={t('tag.general')} />
                      </Form.Item>
                      {fields.length > 2 && (
                        <DeleteOutlined onClick={() => remove(field.name)} />
                      )}
                    </Space>
                  ))}
                  <Form.Item>
                    <Button type="dashed" onClick={() => add()} block data-pc-additem>
                      + {t('vouchers.addLine')}
                    </Button>
                    <Form.ErrorList errors={errors} />
                  </Form.Item>
                </>
              )}
            </Form.List>
          )}

          <Form.Item name="narration" label={t('common.narration')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={post.isPending}>
            {t('common.posted')}
          </Button>
        </Form>
        </div>
      </Card>

      <SectionBar>{t('vouchers.recent')}</SectionBar>
      <div ref={containerRef}>
        <Table
          className="pc-report"
          rowKey="id"
          size="small"
          loading={vouchers.isLoading}
          columns={columns}
          dataSource={vouchers.data ?? []}
          pagination={{ defaultPageSize: 15 }}
          rowClassName={rowClassName}
        />
      </div>

      <Modal
        open={voidTarget !== null}
        title={voidTarget ? t('vouchers.voidTitle', { no: voidTarget.no }) : ''}
        okText={t('vouchers.void')}
        okButtonProps={{ danger: true }}
        confirmLoading={voidMut.isPending}
        onCancel={() => setVoidTarget(null)}
        onOk={() => {
          if (!voidReason.trim()) {
            message.error(t('vouchers.voidReasonRequired'))
            return
          }
          if (voidTarget) voidMut.mutate({ id: voidTarget.id, reason: voidReason })
        }}
      >
        <p style={{ marginBottom: 12 }}>{t('vouchers.voidHint')}</p>
        <Input.TextArea
          rows={3}
          autoFocus
          placeholder={t('vouchers.voidReason')}
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
        />
      </Modal>
    </div>
  )
}
