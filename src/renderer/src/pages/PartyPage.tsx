import { useState } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { FileExcelOutlined, PrinterOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_TYPES, LOAN_CATEGORIES, type AccountType } from '@shared/enums'
import type { NumericFilter, NumericOp, PartyCriteria, PartyRow } from '@shared/contracts'
import { balanceLabel, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { BalanceAmount } from '../components/Highlight'
import { PageBanner } from '../components/report'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { useTablePage } from '../lib/useTablePage'

type NumField = { op?: NumericOp; value?: number; value2?: number } | undefined

function numFromField(f: NumField, paise: boolean): NumericFilter | undefined {
  if (!f || !f.op || f.value === undefined || f.value === null) return undefined
  return {
    op: f.op,
    value: paise ? toPaise(f.value) : f.value,
    value2: f.value2 != null ? (paise ? toPaise(f.value2) : f.value2) : undefined
  }
}

function fieldFromNum(f: NumericFilter | undefined, paise: boolean): NumField {
  if (!f) return undefined
  return {
    op: f.op,
    value: paise ? paiseToRupees(f.value) : f.value,
    value2: f.value2 != null ? (paise ? paiseToRupees(f.value2) : f.value2) : undefined
  }
}

function buildCriteria(v: Record<string, unknown>): PartyCriteria {
  const c: PartyCriteria = {}
  if (v.type) c.type = v.type as AccountType
  if (v.name) c.name = v.name as string
  if (v.village) c.village = v.village as string
  if (v.phone) c.phone = v.phone as string
  if (v.defaulter === 'yes') c.defaulter = true
  else if (v.defaulter === 'no') c.defaulter = false
  if (v.multiRole) c.multiRole = true
  if (v.owes && v.owes !== 'any') c.owes = v.owes as 'us' | 'them'
  if (v.hasLoan) c.hasLoan = true
  if (v.hasActivity) c.hasActivity = true
  if (v.loanCategory) c.loanCategory = v.loanCategory as PartyCriteria['loanCategory']
  const balance = numFromField(v.balance as NumField, true)
  const packetsBrought = numFromField(v.packetsBrought as NumField, false)
  const currentStock = numFromField(v.currentStock as NumField, false)
  const packetsSold = numFromField(v.packetsSold as NumField, false)
  const standingBhada = numFromField(v.standingBhada as NumField, true)
  const loanOutstanding = numFromField(v.loanOutstanding as NumField, true)
  if (balance) c.balance = balance
  if (packetsBrought) c.packetsBrought = packetsBrought
  if (currentStock) c.currentStock = currentStock
  if (packetsSold) c.packetsSold = packetsSold
  if (standingBhada) c.standingBhada = standingBhada
  if (loanOutstanding) c.loanOutstanding = loanOutstanding
  return c
}

function criteriaToForm(c: PartyCriteria): Record<string, unknown> {
  return {
    type: c.type,
    name: c.name,
    village: c.village,
    phone: c.phone,
    defaulter: c.defaulter === undefined ? undefined : c.defaulter ? 'yes' : 'no',
    multiRole: c.multiRole,
    owes: c.owes ?? 'any',
    hasLoan: c.hasLoan,
    hasActivity: c.hasActivity,
    loanCategory: c.loanCategory,
    balance: fieldFromNum(c.balance, true),
    packetsBrought: fieldFromNum(c.packetsBrought, false),
    currentStock: fieldFromNum(c.currentStock, false),
    packetsSold: fieldFromNum(c.packetsSold, false),
    standingBhada: fieldFromNum(c.standingBhada, true),
    loanOutstanding: fieldFromNum(c.loanOutstanding, true)
  }
}

/** A label + (op, value, value2-when-between) row bound to nested form fields under `name`. */
function NumericRow({ name, label, addon }: { name: string; label: string; addon?: string }): JSX.Element {
  const { t } = useTranslation()
  const form = Form.useFormInstance()
  const op = Form.useWatch([name, 'op'], form) as NumericOp | undefined
  const opOptions = [
    { value: 'eq', label: '=' },
    { value: 'lte', label: '≤' },
    { value: 'gte', label: '≥' },
    { value: 'between', label: t('party.between') }
  ]
  return (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <Space.Compact>
        <Form.Item name={[name, 'op']} noStyle>
          <Select allowClear style={{ width: 80 }} placeholder="—" options={opOptions} />
        </Form.Item>
        <Form.Item name={[name, 'value']} noStyle>
          <InputNumber style={{ width: 120 }} addonBefore={addon} />
        </Form.Item>
        {op === 'between' && (
          <Form.Item name={[name, 'value2']} noStyle>
            <InputNumber style={{ width: 120 }} addonBefore={addon} />
          </Form.Item>
        )}
      </Space.Compact>
    </Form.Item>
  )
}

export default function PartyPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const [criteria, setCriteria] = useState<PartyCriteria>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const filterNav = useFormKeyNav({ onAccept: () => form.submit() })

  const result = useQuery({
    queryKey: ['party', criteria],
    queryFn: () => window.api.party.search(criteria)
  })
  const { containerRef, rowClassName } = useTableKeyNav(result.data?.rows, (r) =>
    navigate(`/bills/${r.accountId}`, { state: { fromNav: '/party' } })
  )
  const tablePage = useTablePage('party')
  const presets = useQuery({ queryKey: ['party', 'presets'], queryFn: () => window.api.party.savedFilters() })

  const savePreset = useMutation({
    mutationFn: (name: string) => window.api.party.saveFilter(name, criteria),
    onSuccess: () => {
      message.success(t('party.presetSaved'))
      setSaveOpen(false)
      setSaveName('')
      queryClient.invalidateQueries({ queryKey: ['party', 'presets'] })
    },
    onError: (e: Error) => message.error(e.message)
  })
  const deletePreset = useMutation({
    mutationFn: (id: number) => window.api.party.deleteFilter(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['party', 'presets'] }),
    onError: (e: Error) => message.error(e.message)
  })

  const loadPreset = (id: number): void => {
    const p = (presets.data ?? []).find((x) => x.id === id)
    if (!p) return
    form.resetFields()
    form.setFieldsValue(criteriaToForm(p.criteria))
    setCriteria(p.criteria)
  }

  const reset = (): void => {
    form.resetFields()
    setCriteria({})
  }

  const typeOptions = ACCOUNT_TYPES.map((ty) => ({ value: ty, label: t(`accounts.type.${ty}`) }))

  const columns = [
    {
      title: t('accounts.name'),
      dataIndex: 'name',
      render: (name: string, r: PartyRow) => (
        <a onClick={() => navigate(`/bills/${r.accountId}`, { state: { fromNav: '/party' } })}>{name}</a>
      )
    },
    { title: t('bills.sonOf'), dataIndex: 'sonOf', render: (v: string | null) => v ?? '—' },
    { title: t('bills.village'), dataIndex: 'villageCity', render: (v: string | null) => v ?? '—' },
    {
      title: t('accounts.type'),
      dataIndex: 'type',
      render: (ty: AccountType) => <Tag>{t(`accounts.type.${ty}`)}</Tag>
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      render: (v: number) => <BalanceAmount paise={v} />
    },
    { title: t('party.packetsBrought'), dataIndex: 'packetsBrought', align: 'right' as const },
    { title: t('party.currentStock'), dataIndex: 'currentStock', align: 'right' as const },
    {
      title: t('party.standingBhada'),
      dataIndex: 'standingBhadaPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '—')
    },
    {
      title: t('party.loanOutstanding'),
      dataIndex: 'loanOutstandingPaise',
      align: 'right' as const,
      render: (v: number) => (v ? formatINR(v) : '—')
    },
    {
      title: t('common.actions'),
      key: 'a',
      render: (_: unknown, r: PartyRow) => (
        <Space>
          <Button
            size="small"
            onClick={() => navigate(`/bills/${r.accountId}`, { state: { fromNav: '/party' } })}
          >
            {t('party.bill')}
          </Button>
          <Button
            size="small"
            onClick={() => navigate(`/accounts/${r.accountId}`, { state: { fromNav: '/party' } })}
          >
            {t('accounts.ledger')}
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <PageBanner
        title={t('party.title')}
        extra={
          <>
            <Button
              icon={<PrinterOutlined />}
              onClick={() =>
                print(() =>
                  window.api.print.party(
                    Object.keys(criteria).length ? t('party.title') : '',
                    result.data?.rows ?? []
                  )
                )
              }
            >
              {t('common.print')}
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() =>
                exportXlsx(
                  'party-report.xlsx',
                  t('party.title'),
                  [
                    'Name',
                    's/o',
                    'Village',
                    'Phone',
                    'Type',
                    'Subgroup',
                    'Balance',
                    'Packets Brought',
                    'Aamads',
                    'Current Stock',
                    'Packets Sold',
                    'Standing Rent',
                    'Loan Outstanding',
                    'Bardana Qty'
                  ],
                  (result.data?.rows ?? []).map((r) => [
                    r.name,
                    r.sonOf ?? '',
                    r.villageCity ?? '',
                    r.phone ?? '',
                    r.type,
                    r.subgroupName,
                    paiseToRupees(r.balancePaise),
                    r.packetsBrought,
                    r.aamadCount,
                    r.currentStock,
                    r.packetsSold,
                    paiseToRupees(r.standingBhadaPaise),
                    paiseToRupees(r.loanOutstandingPaise),
                    r.bardanaQty
                  ]),
                  [6, 11, 12] // Balance, Standing Rent, Loan Outstanding
                )
              }
            >
              {t('common.excel')}
            </Button>
          </>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div ref={filterNav.containerRef} onKeyDownCapture={filterNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ owes: 'any' }}
          onFinish={(v) => setCriteria(buildCriteria(v))}
        >
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="name" label={t('accounts.name')} style={{ marginBottom: 8 }}>
                <Input allowClear />
              </Form.Item>
              <Form.Item name="type" label={t('accounts.type')} style={{ marginBottom: 8 }}>
                <Select allowClear options={typeOptions} placeholder={t('common.all')} />
              </Form.Item>
              <Form.Item name="village" label={t('bills.village')} style={{ marginBottom: 8 }}>
                <Input allowClear />
              </Form.Item>
              <Form.Item name="phone" label={t('bills.phone')} style={{ marginBottom: 8 }}>
                <Input allowClear />
              </Form.Item>
              <Form.Item name="defaulter" label={t('accounts.defaulter')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('common.all')}
                  options={[
                    { value: 'yes', label: t('party.yes') },
                    { value: 'no', label: t('party.no') }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="owes" label={t('party.owes')} style={{ marginBottom: 8 }}>
                <Select
                  options={[
                    { value: 'any', label: t('common.all') },
                    { value: 'us', label: t('party.owesUs') },
                    { value: 'them', label: t('party.weOwe') }
                  ]}
                />
              </Form.Item>
              <NumericRow name="balance" label={t('party.balance')} addon="₹" />
              <NumericRow name="standingBhada" label={t('party.standingBhada')} addon="₹" />
              <NumericRow name="loanOutstanding" label={t('party.loanOutstanding')} addon="₹" />
            </Col>
            <Col span={6}>
              <NumericRow name="packetsBrought" label={t('party.packetsBrought')} />
              <NumericRow name="currentStock" label={t('party.currentStock')} />
              <NumericRow name="packetsSold" label={t('party.packetsSold')} />
              <Form.Item name="loanCategory" label={t('loans.category')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('common.all')}
                  options={LOAN_CATEGORIES.map((c) => ({ value: c, label: t(`loans.cat.${c}`) }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="multiRole" valuePropName="checked" style={{ marginBottom: 8 }}>
                <Checkbox>{t('party.multiRole')}</Checkbox>
              </Form.Item>
              <Form.Item name="hasLoan" valuePropName="checked" style={{ marginBottom: 8 }}>
                <Checkbox>{t('party.hasLoan')}</Checkbox>
              </Form.Item>
              <Form.Item name="hasActivity" valuePropName="checked" style={{ marginBottom: 8 }}>
                <Checkbox>{t('party.hasActivity')}</Checkbox>
              </Form.Item>
            </Col>
          </Row>

          <Space wrap>
            <Button type="primary" htmlType="submit">
              {t('common.search')}
            </Button>
            <Button onClick={reset}>{t('party.reset')}</Button>
            <Button onClick={() => setSaveOpen(true)}>{t('party.savePreset')}</Button>
            <Select
              style={{ width: 220 }}
              placeholder={t('party.loadPreset')}
              options={(presets.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => loadPreset(id)}
            />
            {(presets.data ?? []).length > 0 && (
              <Select
                style={{ width: 160 }}
                placeholder={t('party.deletePreset')}
                options={(presets.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={(id) => deletePreset.mutate(id)}
              />
            )}
          </Space>
        </Form>
        </div>
      </Card>

      <Space style={{ marginBottom: 8 }}>
        <Typography.Text strong>
          {t('party.count', { count: result.data?.count ?? 0 })}
        </Typography.Text>
        {!!result.data?.count && (
          <Typography.Text type="secondary">
            {t('party.totalBalance')}: {balanceLabel(result.data.totalBalancePaise)} ·{' '}
            {t('party.totalLoans')}: {formatINR(result.data.totalLoanOutstandingPaise)}
          </Typography.Text>
        )}
      </Space>

      <div ref={containerRef}>
        <Table
          rowKey="accountId"
          size="small"
          loading={result.isLoading}
          columns={columns}
          dataSource={result.data?.rows ?? []}
          pagination={{ defaultPageSize: 20, current: tablePage.current, onChange: tablePage.onChange }}
          rowClassName={rowClassName}
        />
      </div>

      <AutoFocusModal
        title={t('party.savePreset')}
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={() => savePreset.mutate(saveName)}
        confirmLoading={savePreset.isPending}
        okText={t('common.save')}
      >
        <Input
          autoFocus
          placeholder={t('party.presetName')}
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onPressEnter={() => savePreset.mutate(saveName)}
        />
      </AutoFocusModal>
    </div>
  )
}
