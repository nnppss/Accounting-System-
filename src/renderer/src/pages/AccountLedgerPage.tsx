import { useState, type ReactNode } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Table,
  Tabs,
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
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DrCr } from '@shared/enums'
import type { AccountIdentityInput, LedgerLine } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, toPaise } from '../lib/format'
import { BalanceAmount, BalanceSentence } from '../components/Highlight'
import { SuggestInput } from '../components/SuggestInput'
import { PageBanner, SectionBar, StatusPill } from '../components/report'
import { usePrinter } from '../lib/usePrinter'
import { useAccountsFilter } from '../store/accountsFilter'
import { useSession } from '../store/session'
import { useFormKeyNav } from '../lib/useFormKeyNav'
import { AccountOverview } from '../components/AccountOverview'

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
  // If this ledger was opened from another section (e.g. Party), go back there so the dashboard
  // doesn't switch out from under the user. Default to the accounts list otherwise.
  const location = useLocation()
  const backTarget = (location.state as { fromNav?: string } | null)?.fromNav ?? '/accounts'

  const [tab, setTab] = useState('overview')
  const [openingOpen, setOpeningOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [openingForm] = Form.useForm()
  const [deleteForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const openingNav = useFormKeyNav({ open: openingOpen, onAccept: () => openingForm.submit() })
  const editNav = useFormKeyNav({ open: editOpen, onAccept: () => editForm.submit() })

  const detail = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => window.api.accounts.detail(accountId)
  })
  const ledger = useQuery({
    queryKey: ['ledger', accountId],
    queryFn: () => window.api.accounts.ledger(accountId)
  })
  // Same key as the Overview tab, so this is served from cache. Gives us the accrued-but-unposted
  // loan interest (newBalance − balance) to show as a standing-interest total under the ledger.
  const overview = useQuery({
    queryKey: ['overview', accountId],
    queryFn: () => window.api.accounts.overview(accountId)
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

  // The flag has year-end consequences either way — confirm both marking and clearing.
  const onToggleDefaulter = (): void => {
    if (!acct) return
    if (acct.isDefaulter) {
      modal.confirm({
        title: t('accounts.clearDefaulterTitle'),
        content: t('accounts.clearDefaulterConfirm', { name: acct.name }),
        okText: t('accounts.clearDefaulter'),
        okButtonProps: { danger: true },
        onOk: () => toggleDefaulter.mutate(false)
      })
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
      queryClient.invalidateQueries({ queryKey: ['personFieldValues'] })
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
      navigate(backTarget)
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

  // Human-readable voucher label: the business document (from source module) on top with its
  // reference no., and the plain money action (Paid/Received/Transfer) underneath — replaces the
  // bare "Payment #3 / Journal #8" accounting jargon.
  const DOCS = ['loan', 'bhada', 'nikasi', 'bardana', 'salary', 'opening', 'cheque', 'manual']
  const voucherLabel = (r: LedgerLine): JSX.Element => {
    const doc = r.sourceModule && DOCS.includes(r.sourceModule) ? t(`ledger.doc.${r.sourceModule}`) : null
    const action = r.type !== 'journal' ? t(`ledger.action.${r.type}`) : null
    const primary = doc ?? action ?? t(`vouchers.${r.type}`)
    return (
      <div>
        <span>
          {primary} <Typography.Text type="secondary">#{r.voucherNo}</Typography.Text>
        </span>
        {doc && action && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {action}
            </Typography.Text>
          </div>
        )}
      </div>
    )
  }

  const columns = [
    { title: t('common.date'), dataIndex: 'date', width: 110, render: (v: string) => formatDate(v) },
    {
      title: t('vouchers.type'),
      key: 'voucher',
      width: 120,
      render: (_: unknown, r: LedgerLine) => voucherLabel(r)
    },
    {
      title: t('vouchers.tag'),
      dataIndex: 'tag',
      width: 90,
      render: (tag: string) => (tag === 'general' ? '' : <Tag>{t(`tag.${tag}`)}</Tag>)
    },
    {
      title: t('ledger.mode'),
      dataIndex: 'mode',
      width: 160,
      // A cash/bank/cheque leg fills this; a Bhada/Nikasi entry moves no money, so it's on credit.
      render: (m: string) => m || <Typography.Text type="secondary">{t('ledger.mode.credit')}</Typography.Text>
    },
    { title: t('common.narration'), dataIndex: 'narration', render: (n: string | null) => n ?? '—' },
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
      render: (v: number) => <BalanceAmount paise={v} />
    }
  ]

  const dash = (v: string | null): string => v || '—'

  return (
    <div>
      {/* Rippling-style account banner: code · name, type/subgroup underneath, Back keeps filters
          and Close clears them. */}
      <PageBanner
        title={
          <Space size={8} align="baseline">
            <Tooltip title={t('accounts.backToList')}>
              <Button
                size="small"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate(backTarget)}
              />
            </Tooltip>
            {acct?.code && <span style={{ opacity: 0.75, fontWeight: 600 }}>{acct.code}</span>}
            <span>{acct?.name ?? `#${accountId}`}</span>
          </Space>
        }
        subtitle={
          acct
            ? [t(`accounts.type.${acct.type}`), acct.subgroupName].filter(Boolean).join(' · ')
            : undefined
        }
        extra={
          <>
            {acct?.isDefaulter && (
              <StatusPill tone="danger">{t('accounts.defaulter')}</StatusPill>
            )}
            <Tooltip title={t('accounts.closeAccount')}>
              <Button
                icon={<CloseOutlined />}
                onClick={() => {
                  resetFilters()
                  navigate(backTarget)
                }}
              >
                {t('common.close')}
              </Button>
            </Tooltip>
          </>
        }
      />

      {/* Account details section (type · subgroup already sit in the banner above) */}
      <SectionBar>{t('accounts.details')}</SectionBar>
      <Card size="small" style={{ marginBottom: 16 }} loading={detail.isLoading}>
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 28, rowGap: 8 }}>
          {acct?.type === 'bank' ? (
            <>
              <IdentityItem label={t('accounts.bankAccountNumber')}>
                {dash(acct?.bankAccountNumber ?? null)}
              </IdentityItem>
              <IdentityItem label={t('accounts.bankIfsc')}>{dash(acct?.bankIfsc ?? null)}</IdentityItem>
              <IdentityItem label={t('accounts.bankBranch')}>{dash(acct?.bankBranch ?? null)}</IdentityItem>
            </>
          ) : (
            <>
              <IdentityItem label={t('accounts.village')}>{dash(acct?.villageCity ?? null)}</IdentityItem>
              <IdentityItem label="S/o">{dash(acct?.sonOf ?? null)}</IdentityItem>
              <IdentityItem label={t('accounts.state')}>{dash(acct?.state ?? null)}</IdentityItem>
              <IdentityItem label={t('accounts.phone')}>{dash(acct?.phone ?? null)}</IdentityItem>
            </>
          )}
          <IdentityItem label={t('common.balance')}>
            <BalanceAmount paise={acct?.balancePaise ?? 0} strong />
          </IdentityItem>
        </div>

        {acct && (
          <div style={{ marginTop: 12 }}>
            <BalanceSentence name={acct.name} paise={acct.balancePaise} />
          </div>
        )}

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

      {/* Overview (360° tiles + drill-downs) and the raw dr/cr ledger, as tabs. */}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'overview',
            label: t('overview.tab'),
            children: <AccountOverview accountId={accountId} onShowLedger={() => setTab('ledger')} />
          },
          {
            key: 'ledger',
            label: t('accounts.ledger'),
            children: (
              <>
              <SectionBar>{t('accounts.ledger')}</SectionBar>
              <Table
                className="pc-report"
                rowKey="voucherId"
                size="small"
                loading={ledger.isLoading}
                columns={columns}
                dataSource={ledger.data ?? []}
                pagination={false}
                summary={(rows) => {
                  const last = rows[rows.length - 1] as LedgerLine | undefined
                  if (!last) return null
                  const newBalance = overview.data?.money.newBalancePaise ?? last.balancePaise
                  const standingInterest = newBalance - last.balancePaise
                  const totalDr = rows.reduce((s, r) => s + (r as LedgerLine).drPaise, 0)
                  const totalCr = rows.reduce((s, r) => s + (r as LedgerLine).crPaise, 0)
                  return (
                    <>
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={5} align="right">
                          <strong>{t('common.total')}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right">
                          <strong>{formatINR(totalDr)}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right">
                          <strong>{formatINR(totalCr)}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right">
                          <BalanceAmount paise={last.balancePaise} strong />
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                      {standingInterest !== 0 && (
                        <>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={7} align="right">
                              {t('overview.standingInterest')}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">
                              {formatINR(standingInterest)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={7} align="right">
                              <strong>{t('overview.newBalance')}</strong>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">
                              <BalanceAmount paise={newBalance} strong />
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        </>
                      )}
                    </>
                  )
                }}
              />
              </>
            )
          }
        ]}
      />

      {/* Set opening balance */}
      <AutoFocusModal
        title={`${t('accounts.openingBalance')} — ${acct?.name ?? ''}`}
        open={openingOpen}
        onCancel={() => setOpeningOpen(false)}
        onOk={() => openingForm.submit()}
        confirmLoading={setOpening.isPending}
        okText={t('common.save')}
      >
        <div ref={openingNav.containerRef} onKeyDownCapture={openingNav.onKeyDownCapture}>
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
            <DatePicker style={{ width: '100%' }} format={DATE_INPUT_FORMATS} />
          </Form.Item>
        </Form>
        </div>
      </AutoFocusModal>

      {/* Delete account — confirmation + password gate */}
      <AutoFocusModal
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
      </AutoFocusModal>

      {/* Edit identity — village/state/phone/s-o. Type & subgroup are fixed at creation. */}
      <AutoFocusModal
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
        <div ref={editNav.containerRef} onKeyDownCapture={editNav.onKeyDownCapture}>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => updateIdentity.mutate(v as AccountIdentityInput)}
        >
          <Form.Item name="sonOf" label="S/o">
            <SuggestInput field="sonOf" />
          </Form.Item>
          <Form.Item name="villageCity" label={t('accounts.village')}>
            <SuggestInput field="villageCity" />
          </Form.Item>
          <Form.Item name="state" label={t('accounts.state')}>
            <SuggestInput field="state" />
          </Form.Item>
          <Form.Item name="phone" label={t('accounts.phone')}>
            <Input />
          </Form.Item>
        </Form>
        </div>
      </AutoFocusModal>
    </div>
  )
}
