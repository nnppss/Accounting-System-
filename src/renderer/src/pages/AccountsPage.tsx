import { useState } from 'react'
import {
  App as AntApp,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { ACCOUNT_TYPES, type AccountType, type DrCr } from '@shared/enums'
import type { AccountListRow } from '@shared/contracts'
import { balanceLabel, toPaise } from '../lib/format'

export default function AccountsPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [type, setType] = useState<AccountType | undefined>()
  const [search, setSearch] = useState('')
  const [includeSystem, setIncludeSystem] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [personOpen, setPersonOpen] = useState(false)
  const [openingFor, setOpeningFor] = useState<AccountListRow | null>(null)

  const [accountForm] = Form.useForm()
  const [personForm] = Form.useForm()
  const [openingForm] = Form.useForm()

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  const accounts = useQuery({
    queryKey: ['accounts', type, search, includeSystem],
    queryFn: () => window.api.accounts.list({ type, search: search || undefined, includeSystem })
  })
  const subgroups = useQuery({ queryKey: ['subgroups'], queryFn: () => window.api.accounts.subgroups() })
  const persons = useQuery({ queryKey: ['persons'], queryFn: () => window.api.persons.list() })

  const createAccount = useMutation({
    mutationFn: (v: {
      name: string
      type: AccountType
      subgroupId: number
      personId?: number
      job?: string
    }) => window.api.accounts.create(v),
    onSuccess: () => {
      message.success(t('accounts.created'))
      setNewOpen(false)
      accountForm.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const createPerson = useMutation({
    mutationFn: (v: { name: string; sonOf?: string; villageCity?: string; phone?: string }) =>
      window.api.persons.create(v),
    onSuccess: (id) => {
      setPersonOpen(false)
      personForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['persons'] })
      accountForm.setFieldValue('personId', id)
    },
    onError: (e: Error) => message.error(e.message)
  })

  const setOpening = useMutation({
    mutationFn: (v: { accountId: number; amount: number; drCr: DrCr; date: string }) =>
      window.api.accounts.setOpening(v.accountId, toPaise(v.amount), v.drCr, v.date),
    onSuccess: () => {
      setOpeningFor(null)
      openingForm.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const toggleDefaulter = useMutation({
    mutationFn: (v: { id: number; value: boolean }) =>
      window.api.accounts.setDefaulter(v.id, v.value),
    onSuccess: invalidate,
    onError: (e: Error) => message.error(e.message)
  })

  const typeOptions = ACCOUNT_TYPES.map((ty) => ({ value: ty, label: t(`accounts.type.${ty}`) }))
  const subgroupOptions = (subgroups.data ?? []).map((s) => ({ value: s.id, label: s.name }))
  const personOptions = (persons.data ?? []).map((p) => ({
    value: p.id,
    label: p.sonOf ? `${p.name} s/o ${p.sonOf}` : p.name
  }))

  const columns = [
    {
      title: t('accounts.name'),
      dataIndex: 'name',
      render: (name: string, r: AccountListRow) => (
        <Space>
          <a onClick={() => navigate(`/accounts/${r.id}`)}>{name}</a>
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
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_: unknown, r: AccountListRow) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/accounts/${r.id}`)}>
            {t('accounts.ledger')}
          </Button>
          <Button size="small" onClick={() => setOpeningFor(r)}>
            {t('accounts.setOpening')}
          </Button>
          <Button
            size="small"
            danger={!r.isDefaulter}
            onClick={() => toggleDefaulter.mutate({ id: r.id, value: !r.isDefaulter })}
          >
            {r.isDefaulter ? t('accounts.clearDefaulter') : t('accounts.markDefaulter')}
          </Button>
        </Space>
      )
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

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          style={{ width: 180 }}
          placeholder={t('accounts.type')}
          options={typeOptions}
          value={type}
          onChange={(v) => setType(v)}
        />
        <Input.Search
          placeholder={t('common.search')}
          style={{ width: 240 }}
          allowClear
          onSearch={(v) => setSearch(v)}
        />
        <Checkbox checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)}>
          {t('accounts.includeSystem')}
        </Checkbox>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={accounts.isLoading}
        columns={columns}
        dataSource={accounts.data ?? []}
        pagination={{ pageSize: 20 }}
      />

      {/* New account */}
      <Modal
        title={t('accounts.new')}
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={() => accountForm.submit()}
        confirmLoading={createAccount.isPending}
        okText={t('common.create')}
      >
        <Form form={accountForm} layout="vertical" onFinish={(v) => createAccount.mutate(v)}>
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
                  options={personOptions}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  placeholder={t('accounts.person')}
                />
              </Form.Item>
              <Button onClick={() => setPersonOpen(true)}>+</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(p, c) => p.type !== c.type}
          >
            {({ getFieldValue }) =>
              getFieldValue('type') === 'staff' ? (
                <Form.Item name="job" label={t('accounts.job')}>
                  <Input />
                </Form.Item>
              ) : null
            }
          </Form.Item>
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
          <Form.Item name="villageCity" label="Village / City">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* Opening balance */}
      <Modal
        title={`${t('accounts.openingBalance')} — ${openingFor?.name ?? ''}`}
        open={!!openingFor}
        onCancel={() => setOpeningFor(null)}
        onOk={() => openingForm.submit()}
        confirmLoading={setOpening.isPending}
        okText={t('common.save')}
      >
        <Form
          form={openingForm}
          layout="vertical"
          initialValues={{ drCr: 'dr', date: dayjs() }}
          onFinish={(v) =>
            openingFor &&
            setOpening.mutate({
              accountId: openingFor.id,
              amount: v.amount,
              drCr: v.drCr,
              date: v.date.format('YYYY-MM-DD')
            })
          }
        >
          <Form.Item name="amount" label={t('common.amount')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} addonBefore="₹" />
          </Form.Item>
          <Form.Item name="drCr" label={t('common.balance')}>
            <Radio.Group>
              <Radio.Button value="dr">{t('common.dr')}</Radio.Button>
              <Radio.Button value="cr">{t('common.cr')}</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
