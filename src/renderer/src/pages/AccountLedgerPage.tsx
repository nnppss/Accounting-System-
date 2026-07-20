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
  FileExcelOutlined,
  PrinterOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DrCr } from '@shared/enums'
import type { AccountIdentityInput, AccountInterestRow, LedgerLine } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees, toPaise } from '../lib/format'
import { BalanceAmount, BalanceSentence } from '../components/Highlight'
import { SuggestInput } from '../components/SuggestInput'
import { PageBanner, SectionBar, StatusPill } from '../components/report'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
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
  const exportXlsx = useExporter()
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
  // The interest on this party's loans that hasn't been posted yet, per loan — the standing-interest
  // total under the ledger, and the rows the accountant edits when he fixes it.
  const interest = useQuery({
    queryKey: ['accountInterest', accountId],
    queryFn: () => window.api.loans.accountInterest(accountId)
  })
  const interestRows = interest.data ?? []
  const [fixInterestOpen, setFixInterestOpen] = useState(false)
  const acct = detail.data

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['account', accountId] })
    queryClient.invalidateQueries({ queryKey: ['ledger', accountId] })
    queryClient.invalidateQueries({ queryKey: ['overview', accountId] })
    queryClient.invalidateQueries({ queryKey: ['accountInterest', accountId] })
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

  // Pre-fill from the current opening (if any) so editing shows what's there; otherwise defaults to
  // a Dr balance dated 1 Jan of the working year.
  const openOpening = (): void => {
    if (!acct) return
    openingForm.setFieldsValue({
      amount: acct.openingAmountPaise != null ? acct.openingAmountPaise / 100 : undefined,
      drCr: acct.openingDrCr ?? 'dr',
      date: dayjs(year ? `${year}-01-01` : undefined)
    })
    setOpeningOpen(true)
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
    {
      title: t('moneyBook.counterparty'),
      dataIndex: 'counterparty',
      width: 160,
      render: (c: string) => c || '—'
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

        {acct && (
          <Space style={{ marginTop: 16 }} wrap>
            {/* Identity/defaulter/delete are meaningless for the cold's own Cash/bank heads; the
                opening balance and print apply to every account, system money accounts included. */}
            {!acct.isSystem && (
              <>
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
              </>
            )}
            <Button onClick={openOpening}>
              {acct.hasOpening ? t('accounts.editOpening') : t('accounts.setOpening')}
            </Button>
            {/* Prints whichever tab is open — the Overview snapshot or the full ledger. */}
            <Button
              icon={<PrinterOutlined />}
              onClick={() =>
                print(() =>
                  tab === 'overview'
                    ? window.api.print.overview(accountId)
                    : window.api.print.ledger(accountId)
                )
              }
            >
              {t('common.print')}
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() =>
                exportXlsx(
                  `ledger-${acct.name.replace(/[^\w]+/g, '-').toLowerCase()}.xlsx`,
                  acct.name,
                  [
                    t('common.date'),
                    'Voucher',
                    t('ledger.mode'),
                    t('moneyBook.counterparty'),
                    t('common.narration'),
                    t('common.dr'),
                    t('common.cr'),
                    t('common.balance')
                  ],
                  (ledger.data ?? []).map((r) => [
                    formatDate(r.date),
                    r.voucherNo,
                    r.mode,
                    r.counterparty,
                    r.narration ?? '',
                    r.drPaise ? paiseToRupees(r.drPaise) : '',
                    r.crPaise ? paiseToRupees(r.crPaise) : '',
                    paiseToRupees(r.balancePaise)
                  ]),
                  [5, 6, 7] // Dr, Cr, Balance
                )
              }
            >
              {t('common.excel')}
            </Button>
            {!acct.isSystem && (
              <Button danger onClick={() => setDeleteOpen(true)}>
                {t('common.delete')}
              </Button>
            )}
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
                  // Rows are newest-first, so the current balance is on the first row.
                  const current = rows[0] as LedgerLine | undefined
                  if (!current) return null
                  const standingInterest = interestRows.reduce((s, r) => s + r.interestPaise, 0)
                  const newBalance = current.balancePaise + standingInterest
                  const totalDr = rows.reduce((s, r) => s + (r as LedgerLine).drPaise, 0)
                  const totalCr = rows.reduce((s, r) => s + (r as LedgerLine).crPaise, 0)
                  return (
                    <>
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={6} align="right">
                          <strong>{t('common.total')}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right">
                          <strong>{formatINR(totalDr)}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right">
                          <strong>{formatINR(totalCr)}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={8} align="right">
                          <BalanceAmount paise={current.balancePaise} strong />
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                      {/* Shown for anyone with a loan, even at ₹0 — it is the way in to fixing it. */}
                      {interestRows.length > 0 && (
                        <>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={8} align="right">
                              {t('overview.standingInterest')}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} align="right">
                              <Tooltip title={t('interest.fixHint')}>
                                <Button type="link" style={{ padding: 0 }} onClick={() => setFixInterestOpen(true)}>
                                  {formatINR(standingInterest)}
                                </Button>
                              </Tooltip>
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={8} align="right">
                              <strong>{t('overview.newBalance')}</strong>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} align="right">
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

      {fixInterestOpen && (
        <FixInterestModal
          rows={interestRows}
          accountId={accountId}
          name={acct?.name ?? ''}
          onClose={() => setFixInterestOpen(false)}
          onDone={() => {
            setFixInterestOpen(false)
            invalidate()
            queryClient.invalidateQueries({ queryKey: ['loans'] })
            queryClient.invalidateQueries({ queryKey: ['bill'] })
          }}
        />
      )}

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

/**
 * Fix the interest by hand. The engine's figure is a calculation; what the cold and the party
 * agreed is a fact — round ₹1,529 down to ₹1,500, or add for a delay. Whatever is typed here is
 * posted as the interest up to the chosen date and is never recalculated; interest runs again from
 * that date.
 *
 * One field for the party, not one per loan: the cold settles interest with the man, not with each
 * of his loans ("Nitesh's interest is ₹10,800 to 31 Dec"). His loans can run at different rates
 * from different dates, so `fixPartyInterest` splits the figure back across them pro-rata to what
 * each earned — the accountant never sees that, and the ledger gets a single interest row.
 */
function FixInterestModal({
  rows,
  accountId,
  name,
  onClose,
  onDone
}: {
  rows: AccountInterestRow[]
  accountId: number
  name: string
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const year = useSession((s) => s.session?.year)
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ open: true, onAccept: () => form.submit() })
  // What the engine makes it: everything already fixed, plus whatever is still ticking, across
  // every loan he has. This is the figure in the box, and what he types over.
  const currentPaise = rows.reduce((s, r) => s + r.fixedPaise + r.interestPaise, 0)

  const fix = useMutation({
    mutationFn: async (v: { date: dayjs.Dayjs; interest: number }) => {
      const total = toPaise(v.interest)
      if (total === currentPaise) return false // unchanged — leave the engine's own figure alone
      await window.api.loans.fixPartyInterest(accountId, v.date.format('YYYY-MM-DD'), total)
      return true
    },
    onSuccess: (changed) => {
      message.success(changed ? t('interest.fixedTotal') : t('interest.unchanged'))
      onDone()
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <AutoFocusModal
      open
      title={`${t('interest.fixTitle')} — ${name}`}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={fix.isPending}
      okText={t('common.save')}
    >
      <Typography.Paragraph type="secondary">{t('interest.fixHelp')}</Typography.Paragraph>
      <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            // Year-end: the cold settles interest up to 31 Dec and that is what the date normally
            // means here — "₹10,800 till the year is out". Any date can be typed over it.
            date: dayjs(`${year ?? dayjs().year()}-12-31`),
            interest: currentPaise / 100
          }}
          onFinish={(v) => fix.mutate(v)}
        >
          <Form.Item
            name="interest"
            label={t('loans.interest')}
            rules={[{ required: true }]}
            extra={rows.length > 1 ? t('interest.acrossLoans', { count: rows.length }) : undefined}
          >
            <InputNumber min={0} precision={2} addonBefore="₹" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="date" label={t('interest.till')} rules={[{ required: true }]}>
            <DatePicker format={DATE_INPUT_FORMATS} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </div>
    </AutoFocusModal>
  )
}
