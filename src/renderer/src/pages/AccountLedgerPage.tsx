import { useState, type ReactNode } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  ArrowLeftOutlined,
  CloseOutlined,
  EditOutlined,
  PrinterOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DrCr } from '@shared/enums'
import type { AccountIdentityInput, LedgerLine } from '@shared/contracts'
import { balanceLabel, formatINR, toPaise } from '../lib/format'
import { usePrinter } from '../lib/usePrinter'
import { useAccountsFilter } from '../store/accountsFilter'
import { useSession } from '../store/session'

/**
 * One identity field as "Label: value". Sits in a flex-wrap row so the whole strip reflows to as
 * many lines as needed; long values wrap within the item instead of breaking mid-word.
 */
function IdentityItem({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', maxWidth: 280 }}>
      <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
        {label}:
      </Typography.Text>
      <span style={{ overflowWrap: 'break-word', minWidth: 0 }}>{children}</span>
    </div>
  )
}

export default function AccountLedgerPage(): JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = AntApp.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resetFilters = useAccountsFilter((s) => s.reset)
  const year = useSession((s) => s.session?.year)
  const print = usePrinter()
  const { id } = useParams()
  const accountId = Number(id)

  const [openingOpen, setOpeningOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [openingForm] = Form.useForm()
  const [deleteForm] = Form.useForm()
  const [editForm] = Form.useForm()

  const detail = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => window.api.accounts.detail(accountId)
  })
  const ledger = useQuery({
    queryKey: ['ledger', accountId],
    queryFn: () => window.api.accounts.ledger(accountId)
  })
  const acct = detail.data

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['account', accountId] })
    queryClient.invalidateQueries({ queryKey: ['ledger', accountId] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  const toggleDefaulter = useMutation({
    mutationFn: (value: boolean) => window.api.accounts.setDefaulter(accountId, value),
    onSuccess: invalidate,
    onError: (e: Error) => message.error(e.message)
  })

  // Marking a defaulter is a flag with consequences (year-end) — confirm first. Clearing is direct.
  const onToggleDefaulter = (): void => {
    if (!acct) return
    if (acct.isDefaulter) {
      toggleDefaulter.mutate(false)
      return
    }
    modal.confirm({
      title: t('accounts.markDefaulterTitle'),
      content: t('accounts.markDefaulterConfirm', { name: acct.name }),
      okText: t('accounts.markDefaulter'),
      okButtonProps: { danger: true },
      onOk: () => toggleDefaulter.mutate(true)
    })
  }

  const updateIdentity = useMutation({
    mutationFn: (input: AccountIdentityInput) =>
      window.api.accounts.updateIdentity(accountId, input),
    onSuccess: () => {
      message.success(t('accounts.identitySaved'))
      setEditOpen(false)
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const openEdit = (): void => {
    if (!acct) return
    editForm.setFieldsValue({
      sonOf: acct.sonOf ?? '',
      villageCity: acct.villageCity ?? '',
      state: acct.state ?? '',
      phone: acct.phone ?? ''
    })
    setEditOpen(true)
  }

  const setOpening = useMutation({
    mutationFn: (v: { amount: number; drCr: DrCr; date: string }) =>
      window.api.accounts.setOpening(accountId, toPaise(v.amount), v.drCr, v.date),
    onSuccess: () => {
      message.success(t('accounts.openingSaved'))
      setOpeningOpen(false)
      openingForm.resetFields()
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const deleteAccount = useMutation({
    mutationFn: (password: string) => window.api.accounts.delete(accountId, password),
    onSuccess: () => {
      message.success(t('accounts.deleted'))
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      navigate('/accounts')
    },
    onError: (e: Error) => {
      // Electron wraps IPC errors as "Error invoking remote method '…': Error: <message>".
      // Strip that wrapper so the user sees only the real reason.
      const msg = e.message.replace(/^Error invoking remote method '[^']*':\s*Error:\s*/, '')
      // A reference-block message is multi-line and actionable — show it in a dialog the user can
      // actually read, not a one-line toast. Simple errors (e.g. wrong password) stay as a toast.
      if (msg.includes('cannot be deleted')) {
        setDeleteOpen(false)
        deleteForm.resetFields()
        modal.error({
          title: t('accounts.deleteTitle'),
          width: 520,
          content: <div style={{ whiteSpace: 'pre-line' }}>{msg}</div>
        })
      } else {
        message.error(msg)
      }
    }
  })

  const columns = [
    { title: t('common.date'), dataIndex: 'date', width: 110 },
    {
      title: t('vouchers.type'),
      key: 'voucher',
      width: 120,
      render: (_: unknown, r: LedgerLine) => `${t(`vouchers.${r.type}`)} #${r.voucherNo}`
    },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
    {
      title: 'Tag',
      dataIndex: 'tag',
      width: 90,
      render: (tag: string) => (tag === 'general' ? '' : <Tag>{tag}</Tag>)
    },
    {
      title: t('common.dr'),
      dataIndex: 'drPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.cr'),
      dataIndex: 'crPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      width: 150,
      render: (v: number) => balanceLabel(v)
    }
  ]

  const dash = (v: string | null): string => v || '—'

  return (
    <div>
      {/* Toolbar: Back keeps filters, Close clears them */}
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Tooltip title={t('accounts.backToList')}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounts')} />
          </Tooltip>
          {acct?.code && <Typography.Text code>{acct.code}</Typography.Text>}
          <Typography.Title level={3} style={{ margin: 0 }}>
            {acct?.name ?? `#${accountId}`}
          </Typography.Title>
          {acct && <Tag>{t(`accounts.type.${acct.type}`)}</Tag>}
          {acct?.isDefaulter && <Tag color="red">{t('accounts.defaulter')}</Tag>}
        </Space>
        <Tooltip title={t('accounts.closeAccount')}>
          <Button
            icon={<CloseOutlined />}
            onClick={() => {
              resetFilters()
              navigate('/accounts')
            }}
          >
            {t('common.close')}
          </Button>
        </Tooltip>
      </Space>

      {/* Identity header + actions */}
      <Card size="small" style={{ marginBottom: 16 }} loading={detail.isLoading}>
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 28, rowGap: 8 }}>
          <IdentityItem label={t('accounts.type')}>
            {acct && <Tag style={{ margin: 0 }}>{t(`accounts.type.${acct.type}`)}</Tag>}
          </IdentityItem>
          <IdentityItem label={t('accounts.subgroup')}>{acct?.subgroupName ?? '—'}</IdentityItem>
          <IdentityItem label={t('accounts.village')}>{dash(acct?.villageCity ?? null)}</IdentityItem>
          <IdentityItem label="S/o">{dash(acct?.sonOf ?? null)}</IdentityItem>
          <IdentityItem label={t('accounts.state')}>{dash(acct?.state ?? null)}</IdentityItem>
          <IdentityItem label={t('accounts.phone')}>{dash(acct?.phone ?? null)}</IdentityItem>
          <IdentityItem label={t('common.balance')}>
            {balanceLabel(acct?.balancePaise ?? 0)}
          </IdentityItem>
        </div>

        {acct && !acct.isSystem && (
          <Space style={{ marginTop: 16 }} wrap>
            <Button icon={<EditOutlined />} onClick={openEdit}>
              {t('common.edit')}
            </Button>
            <Button
              danger={!acct.isDefaulter}
              loading={toggleDefaulter.isPending}
              onClick={onToggleDefaulter}
            >
              {acct.isDefaulter ? t('accounts.clearDefaulter') : t('accounts.markDefaulter')}
            </Button>
            {!acct.hasOpening && (
              <Button onClick={() => setOpeningOpen(true)}>{t('accounts.setOpening')}</Button>
            )}
            <Button
              icon={<PrinterOutlined />}
              onClick={() => print(() => window.api.print.ledger(accountId))}
            >
              {t('common.print')}
            </Button>
            <Button danger onClick={() => setDeleteOpen(true)}>
              {t('common.delete')}
            </Button>
          </Space>
        )}
      </Card>

      {/* Ledger — all account activity */}
      <Table
        rowKey="voucherId"
        size="small"
        loading={ledger.isLoading}
        columns={columns}
        dataSource={ledger.data ?? []}
        pagination={false}
        summary={(rows) => {
          const last = rows[rows.length - 1] as LedgerLine | undefined
          return last ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align="right">
                <strong>{t('common.balance')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <strong>{balanceLabel(last.balancePaise)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }}
      />

      {/* Set opening balance */}
      <Modal
        title={`${t('accounts.openingBalance')} — ${acct?.name ?? ''}`}
        open={openingOpen}
        onCancel={() => setOpeningOpen(false)}
        onOk={() => openingForm.submit()}
        confirmLoading={setOpening.isPending}
        okText={t('common.save')}
      >
        <Form
          form={openingForm}
          layout="vertical"
          initialValues={{ drCr: 'dr', date: dayjs(year ? `${year}-01-01` : undefined) }}
          onFinish={(v) =>
            setOpening.mutate({ amount: v.amount, drCr: v.drCr, date: v.date.format('YYYY-MM-DD') })
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

      {/* Delete account — confirmation + password gate */}
      <Modal
        title={t('accounts.deleteTitle')}
        open={deleteOpen}
        onCancel={() => {
          setDeleteOpen(false)
          deleteForm.resetFields()
        }}
        onOk={() => deleteForm.submit()}
        confirmLoading={deleteAccount.isPending}
        okText={t('common.delete')}
        okButtonProps={{ danger: true }}
      >
        <Typography.Paragraph>
          {t('accounts.deleteConfirm', { name: acct?.name ?? '' })}
        </Typography.Paragraph>
        <Form form={deleteForm} layout="vertical" onFinish={(v) => deleteAccount.mutate(v.password)}>
          <Form.Item name="password" label={t('common.password')} rules={[{ required: true }]}>
            <Input.Password autoFocus onPressEnter={() => deleteForm.submit()} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit identity — village/state/phone/s-o. Type & subgroup are fixed at creation. */}
      <Modal
        title={`${t('accounts.editIdentity')} — ${acct?.name ?? ''}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={updateIdentity.isPending}
        okText={t('common.save')}
      >
        <Space style={{ marginBottom: 12 }} size="large" wrap>
          <IdentityItem label={t('accounts.type')}>
            {acct && <Tag style={{ margin: 0 }}>{t(`accounts.type.${acct.type}`)}</Tag>}
          </IdentityItem>
          <IdentityItem label={t('accounts.subgroup')}>{acct?.subgroupName ?? '—'}</IdentityItem>
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('accounts.typeSubgroupLocked')}
        </Typography.Paragraph>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => updateIdentity.mutate(v as AccountIdentityInput)}
        >
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
