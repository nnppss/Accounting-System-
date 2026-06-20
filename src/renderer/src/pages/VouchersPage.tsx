import { useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Divider,
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
import type { VoucherListRow } from '@shared/contracts'
import type { VoucherType } from '@shared/enums'
import { formatINR, toPaise } from '../lib/format'

type Mode = 'receipt' | 'payment' | 'contra' | 'journal'

export default function VouchersPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('receipt')
  const [form] = Form.useForm()

  const parties = useQuery({ queryKey: ['accounts', 'parties'], queryFn: () => window.api.accounts.list({}) })
  const allAccounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => window.api.accounts.list({ includeSystem: true })
  })
  const cashBanks = useQuery({ queryKey: ['cashbanks'], queryFn: () => window.api.moneybook.accounts() })
  const vouchers = useQuery({ queryKey: ['vouchers'], queryFn: () => window.api.vouchers.list() })

  const partyOptions = (parties.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  const allOptions = (allAccounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  const cashOptions = (cashBanks.data ?? []).map((a) => ({ value: a.id, label: a.name }))

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
      if (mode === 'receipt') {
        return window.api.vouchers.receipt({
          date,
          narration,
          partyAccountId: values.partyAccountId as number,
          cashBankAccountId: values.cashBankAccountId as number,
          amountPaise: toPaise(values.amount as number)
        })
      }
      if (mode === 'payment') {
        return window.api.vouchers.payment({
          date,
          narration,
          partyAccountId: values.partyAccountId as number,
          cashBankAccountId: values.cashBankAccountId as number,
          amountPaise: toPaise(values.amount as number)
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
      const lines = (values.lines as Array<{ accountId: number; dr?: number; cr?: number }>) ?? []
      return window.api.vouchers.journal({
        date,
        narration,
        entries: lines.map((l) => ({
          accountId: l.accountId,
          drPaise: toPaise(l.dr),
          crPaise: toPaise(l.cr)
        }))
      })
    },
    onSuccess: (r) => onPosted(r.voucherNo),
    onError
  })

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
    { title: t('common.date'), dataIndex: 'date', width: 110 },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: t('common.total'),
      dataIndex: 'totalPaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('vouchers.title')}
      </Typography.Title>

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

        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs(), lines: [{}, {}] }}
          onFinish={(v) => post.mutate(v)}
        >
          <Space size="large" style={{ display: 'flex' }} align="start" wrap>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            {mode !== 'journal' && (
              <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: 200 }} />
              </Form.Item>
            )}
          </Space>

          {(mode === 'receipt' || mode === 'payment') && (
            <>
              <Form.Item name="partyAccountId" label={t('vouchers.party')} rules={[{ required: true }]}>
                <Select options={partyOptions} showSearch optionFilterProp="label" />
              </Form.Item>
              <Form.Item
                name="cashBankAccountId"
                label={t('vouchers.cashBank')}
                rules={[{ required: true }]}
              >
                <Select options={cashOptions} showSearch optionFilterProp="label" />
              </Form.Item>
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
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
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
                      {fields.length > 2 && (
                        <DeleteOutlined onClick={() => remove(field.name)} />
                      )}
                    </Space>
                  ))}
                  <Form.Item>
                    <Button type="dashed" onClick={() => add()} block>
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
      </Card>

      <Divider />
      <Typography.Title level={4}>{t('vouchers.recent')}</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        loading={vouchers.isLoading}
        columns={columns}
        dataSource={vouchers.data ?? []}
        pagination={{ pageSize: 15 }}
      />
    </div>
  )
}
