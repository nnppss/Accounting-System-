import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_TYPES, type AccountType, type DrCr } from '@shared/enums'
import type { AccountInput, AccountListRow } from '@shared/contracts'
import { balanceLabel, toPaise } from '../lib/format'
import { useAccountsFilter, type AccountFilters } from '../store/accountsFilter'
import { useSession } from '../store/session'

/** Debounce a value so we don't fire a query on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** A filter field rendered as a small caption above its control. */
function Labeled({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  )
}

export default function AccountsPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const year = useSession((s) => s.session?.year)

  // Filters live in a store so they survive opening an account and returning (see store comment).
  const { type, filters, includeSystem, setType, setFilters, setIncludeSystem, reset } =
    useAccountsFilter()
  const [newOpen, setNewOpen] = useState(false)
  const [personOpen, setPersonOpen] = useState(false)
  const [personSearch, setPersonSearch] = useState('')
  // Persons selected/created during this session, so their label keeps rendering
  // even when they fall outside the current search results.
  const [pinnedPersons, setPinnedPersons] = useState<{ value: number; label: string }[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  const dFilters = useDebounced(filters, 300)
  const setField =
    (k: keyof AccountFilters) =>
    (e: ChangeEvent<HTMLInputElement>): void =>
      setFilters({ ...filters, [k]: e.target.value })

  // A party-narrowing filter is anything except the system toggle.
  const partyFilterActive = Boolean(
    type ||
      dFilters.name.trim() ||
      dFilters.villageCity.trim() ||
      dFilters.state.trim() ||
      dFilters.phone.trim()
  )
  // The list is intentionally empty until the user filters — there may be thousands of accounts,
  // so we never load them all on open. Ticking "Show system accounts" alone counts as a query.
  const hasQuery = partyFilterActive || includeSystem

  const [accountForm] = Form.useForm()
  const [personForm] = Form.useForm()

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  const accounts = useQuery({
    queryKey: ['accounts', type, dFilters, includeSystem],
    queryFn: () =>
      window.api.accounts.list({
        type,
        name: dFilters.name.trim() || undefined,
        villageCity: dFilters.villageCity.trim() || undefined,
        state: dFilters.state.trim() || undefined,
        phone: dFilters.phone.trim() || undefined,
        // With a party filter active the toggle is additive; on its own it shows just the heads.
        includeSystem: includeSystem && partyFilterActive,
        systemOnly: includeSystem && !partyFilterActive
      }),
    enabled: hasQuery
  })
  const subgroups = useQuery({ queryKey: ['subgroups'], queryFn: () => window.api.accounts.subgroups() })
  // Type-ahead only: don't fetch the full person master on open — wait for a search term.
  const persons = useQuery({
    queryKey: ['persons', personSearch],
    queryFn: () => window.api.persons.list(personSearch),
    enabled: personSearch.trim().length > 0
  })

  const onPersonSearch = (v: string): void => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setPersonSearch(v.trim()), 250)
  }

  const createAccount = useMutation({
    mutationFn: (v: AccountInput) => window.api.accounts.create(v),
    onSuccess: () => {
      message.success(t('accounts.created'))
      setNewOpen(false)
      accountForm.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const createPerson = useMutation({
    mutationFn: (v: {
      name: string
      sonOf?: string
      villageCity?: string
      state?: string
      phone?: string
    }) => window.api.persons.create(v),
    onSuccess: (id, vars) => {
      setPersonOpen(false)
      personForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['persons'] })
      const label = vars.sonOf ? `${vars.name} s/o ${vars.sonOf}` : vars.name
      setPinnedPersons((prev) => [{ value: id, label }, ...prev.filter((p) => p.value !== id)])
      accountForm.setFieldValue('personId', id)
    },
    onError: (e: Error) => message.error(e.message)
  })

  // Build the create payload, attaching an opening balance only when an amount was entered.
  const submitAccount = (v: {
    name: string
    type: AccountType
    subgroupId: number
    personId?: number
    job?: string
    openingAmount?: number
    openingDrCr?: DrCr
  }): void => {
    const opening =
      v.openingAmount && v.openingAmount > 0
        ? {
            amountPaise: toPaise(v.openingAmount),
            drCr: v.openingDrCr ?? 'dr',
            date: `${year ?? new Date().getFullYear()}-01-01`
          }
        : undefined
    createAccount.mutate({
      name: v.name,
      type: v.type,
      subgroupId: v.subgroupId,
      personId: v.personId,
      job: v.job,
      opening
    })
  }

  const typeOptions = ACCOUNT_TYPES.map((ty) => ({ value: ty, label: t(`accounts.type.${ty}`) }))
  const subgroupOptions = (subgroups.data ?? []).map((s) => ({ value: s.id, label: s.name }))
  const personOptions = useMemo(() => {
    // Only surface matches once the user has typed; otherwise just keep pinned (selected/new) ones.
    const base = personSearch.trim()
      ? (persons.data ?? []).map((p) => {
          const id = p.sonOf ? `${p.name} s/o ${p.sonOf}` : p.name
          return { value: p.id, label: p.villageCity ? `${id} · ${p.villageCity}` : id }
        })
      : []
    const ids = new Set(base.map((o) => o.value))
    return [...pinnedPersons.filter((o) => !ids.has(o.value)), ...base]
  }, [persons.data, pinnedPersons, personSearch])

  const columns = [
    {
      title: t('accounts.code'),
      dataIndex: 'code',
      width: 120,
      render: (code: string | null) => (code ? <Typography.Text code>{code}</Typography.Text> : '—')
    },
    {
      title: t('accounts.name'),
      dataIndex: 'name',
      render: (name: string, r: AccountListRow) => (
        <Space>
          <a>{name}</a>
          {r.isDefaulter && <Tag color="red">{t('accounts.defaulter')}</Tag>}
        </Space>
      )
    },
    {
      title: t('accounts.type'),
      dataIndex: 'type',
      render: (ty: AccountType) => <Tag>{t(`accounts.type.${ty}`)}</Tag>
    },
    { title: t('accounts.subgroup'), dataIndex: 'subgroupName' },
    { title: t('accounts.person'), dataIndex: 'personName', render: (p: string | null) => p ?? '—' },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      render: (b: number) => balanceLabel(b)
    }
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('accounts.title')}
        </Typography.Title>
        <Button type="primary" onClick={() => setNewOpen(true)}>
          {t('accounts.new')}
        </Button>
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle" align="end">
          <Labeled label={t('accounts.type')}>
            <Select
              allowClear
              style={{ width: 170 }}
              placeholder={t('accounts.type')}
              options={typeOptions}
              value={type}
              onChange={(v) => setType(v)}
            />
          </Labeled>
          <Labeled label={t('accounts.name')}>
            <Input
              allowClear
              style={{ width: 190 }}
              placeholder={t('accounts.name')}
              value={filters.name}
              onChange={setField('name')}
            />
          </Labeled>
          <Labeled label={t('accounts.village')}>
            <Input
              allowClear
              style={{ width: 190 }}
              placeholder={t('accounts.village')}
              value={filters.villageCity}
              onChange={setField('villageCity')}
            />
          </Labeled>
          <Labeled label={t('accounts.state')}>
            <Input
              allowClear
              style={{ width: 150 }}
              placeholder={t('accounts.state')}
              value={filters.state}
              onChange={setField('state')}
            />
          </Labeled>
          <Labeled label={t('accounts.phone')}>
            <Input
              allowClear
              style={{ width: 170 }}
              placeholder={t('accounts.phone')}
              value={filters.phone}
              onChange={setField('phone')}
            />
          </Labeled>
          <Checkbox
            checked={includeSystem}
            onChange={(e) => setIncludeSystem(e.target.checked)}
            style={{ marginBottom: 6 }}
          >
            {t('accounts.includeSystem')}
          </Checkbox>
          {hasQuery && (
            <Button type="link" onClick={reset} style={{ marginBottom: 6 }}>
              {t('accounts.clearFilters')}
            </Button>
          )}
        </Space>
      </Card>

      {hasQuery ? (
        <Table
          rowKey="id"
          size="small"
          loading={accounts.isFetching}
          columns={columns}
          dataSource={accounts.data ?? []}
          pagination={{ pageSize: 20 }}
          onRow={(r) => ({
            onClick: () => navigate(`/accounts/${r.id}`),
            style: { cursor: 'pointer' }
          })}
        />
      ) : (
        <Empty
          style={{ marginTop: 64 }}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('accounts.searchHint')}
        />
      )}

      {/* New account */}
      <Modal
        title={t('accounts.new')}
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={() => accountForm.submit()}
        confirmLoading={createAccount.isPending}
        okText={t('common.create')}
      >
        <Form
          form={accountForm}
          layout="vertical"
          initialValues={{ openingDrCr: 'dr' }}
          onFinish={submitAccount}
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('accounts.typeSubgroupLocked')}
          />
          <Form.Item name="name" label={t('accounts.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label={t('accounts.type')} rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="subgroupId" label={t('accounts.subgroup')} rules={[{ required: true }]}>
            <Select options={subgroupOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label={t('accounts.person')}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="personId" noStyle>
                <Select
                  allowClear
                  showSearch
                  filterOption={false}
                  onSearch={onPersonSearch}
                  options={personOptions}
                  loading={persons.isFetching}
                  notFoundContent={
                    persons.isFetching ? (
                      <Spin size="small" />
                    ) : personSearch.trim() ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noResults')} />
                    ) : (
                      <Typography.Text type="secondary" style={{ padding: '4px 0', display: 'block' }}>
                        {t('common.typeToSearch')}
                      </Typography.Text>
                    )
                  }
                  style={{ width: '100%' }}
                  placeholder={t('accounts.personSearch')}
                />
              </Form.Item>
              <Button onClick={() => setPersonOpen(true)}>+</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
            {({ getFieldValue }) =>
              getFieldValue('type') === 'staff' ? (
                <Form.Item name="job" label={t('accounts.job')}>
                  <Input />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          {/* Opening balance — entered at setup time; the software carries it forward thereafter. */}
          <Typography.Text type="secondary">{t('accounts.openingOptional')}</Typography.Text>
          <Space style={{ marginTop: 8 }} align="end">
            <Form.Item name="openingAmount" label={t('accounts.openingBalance')} noStyle>
              <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="openingDrCr" noStyle>
              <Radio.Group>
                <Radio.Button value="dr">{t('common.dr')}</Radio.Button>
                <Radio.Button value="cr">{t('common.cr')}</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* New person */}
      <Modal
        title={t('accounts.newPerson')}
        open={personOpen}
        onCancel={() => setPersonOpen(false)}
        onOk={() => personForm.submit()}
        confirmLoading={createPerson.isPending}
        okText={t('common.create')}
      >
        <Form form={personForm} layout="vertical" onFinish={(v) => createPerson.mutate(v)}>
          <Form.Item name="name" label={t('accounts.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sonOf" label="S/o">
            <Input />
          </Form.Item>
          <Form.Item name="villageCity" label={t('accounts.village')}>
            <Input />
          </Form.Item>
          <Form.Item name="state" label={t('accounts.state')}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('accounts.phone')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
