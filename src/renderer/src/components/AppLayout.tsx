import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Typography
} from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  CreditCardOutlined,
  DollarOutlined,
  DownOutlined,
  ExportOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FilterOutlined,
  GlobalOutlined,
  HomeOutlined,
  IdcardOutlined,
  InboxOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WalletOutlined
} from '@ant-design/icons'
import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useSession } from '../store/session'
import AccountsPage from '../pages/AccountsPage'
import AccountLedgerPage from '../pages/AccountLedgerPage'
import PeoplePage from '../pages/PeoplePage'
import VouchersPage from '../pages/VouchersPage'
import TrialBalancePage from '../pages/TrialBalancePage'
import MoneyBookPage from '../pages/MoneyBookPage'
import AamadPage from '../pages/AamadPage'
import MapsPage from '../pages/MapsPage'
import SaudaPage from '../pages/SaudaPage'
import NikasiPage from '../pages/NikasiPage'
import LoansPage from '../pages/LoansPage'
import ChequesPage from '../pages/ChequesPage'
import BardanaPage from '../pages/BardanaPage'
import ExpensesPage from '../pages/ExpensesPage'
import BillsPage from '../pages/BillsPage'
import BillPage from '../pages/BillPage'
import PartyPage from '../pages/PartyPage'
import ClosePage from '../pages/ClosePage'
import AuditPage from '../pages/AuditPage'
import StorePage from '../pages/StorePage'
import HomePage from '../pages/HomePage'
import { palette } from '../theme'
import { useGlobalHotkeys } from '../lib/useHotkeys'
import ShortcutsHelp from './ShortcutsHelp'

const { Header, Content } = Layout

/** Self-service password change for the signed-in accountant; the current password is re-verified
 * in the main process. On success the parent clears the default-password nudge. */
function ChangePasswordModal({
  open,
  onClose,
  onChanged
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()

  const mut = useMutation({
    mutationFn: (v: { current: string; next: string }) =>
      window.api.auth.changePassword(v.current, v.next),
    onSuccess: () => {
      message.success(t('password.changed'))
      form.resetFields()
      onChanged()
      onClose()
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <Modal
      open={open}
      title={t('password.change')}
      okText={t('password.change')}
      cancelText={t('common.cancel')}
      confirmLoading={mut.isPending}
      onOk={() => form.submit()}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mut.mutate({ current: v.current, next: v.next })}
      >
        <Form.Item name="current" label={t('password.current')} rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="next"
          label={t('password.new')}
          rules={[{ required: true }, { min: 6 }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('password.confirm')}
          dependencies={['next']}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('next') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('password.mismatch')))
            })
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function AppLayout(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession((s) => s.session)
  const setSession = useSession((s) => s.setSession)
  const [pwOpen, setPwOpen] = useState(false)

  // Shared detail pages (the account ledger and the bill) can be reached from several sections —
  // e.g. the Party page opens both. When a page is opened that way it passes `fromNav` so the
  // nav keeps the *originating* section highlighted instead of jumping to Accounts/Bills.
  const stateFrom = (location.state as { fromNav?: string } | null)?.fromNav
  const selectedKey = stateFrom ?? '/' + (location.pathname.split('/')[1] || 'home')

  // Grouped horizontal nav: a handful of headers, each opening a dropdown of sections. Leaf keys
  // are route paths; group keys are inert ('g-…') and never fire onClick.
  const items = [
    { key: '/home', icon: <HomeOutlined />, label: t('nav.home') },
    {
      key: 'g-accounts',
      icon: <TeamOutlined />,
      label: t('nav.group.accounts'),
      children: [
        { key: '/accounts', icon: <TeamOutlined />, label: t('nav.accounts') },
        { key: '/people', icon: <IdcardOutlined />, label: t('nav.people') }
      ]
    },
    {
      key: 'g-stock',
      icon: <AppstoreOutlined />,
      label: t('nav.group.stock'),
      children: [
        { key: '/aamad', icon: <InboxOutlined />, label: t('nav.aamad') },
        { key: '/maps', icon: <AppstoreOutlined />, label: t('nav.maps') },
        { key: '/nikasi', icon: <ExportOutlined />, label: t('nav.nikasi') }
      ]
    },
    {
      key: 'g-dealings',
      icon: <FileDoneOutlined />,
      label: t('nav.group.dealings'),
      children: [
        { key: '/sauda', icon: <FileDoneOutlined />, label: t('nav.sauda') },
        { key: '/bardana', icon: <ShoppingOutlined />, label: t('nav.bardana') },
        { key: '/expenses', icon: <ToolOutlined />, label: t('nav.expenses') }
      ]
    },
    {
      key: 'g-money',
      icon: <DollarOutlined />,
      label: t('nav.group.money'),
      children: [
        { key: '/loans', icon: <DollarOutlined />, label: t('nav.loans') },
        { key: '/cheques', icon: <CreditCardOutlined />, label: t('nav.cheques') },
        { key: '/money-book', icon: <WalletOutlined />, label: t('nav.moneyBook') }
      ]
    },
    {
      key: 'g-books',
      icon: <BankOutlined />,
      label: t('nav.group.books'),
      children: [
        { key: '/vouchers', icon: <BankOutlined />, label: t('nav.vouchers') },
        { key: '/trial-balance', icon: <BookOutlined />, label: t('nav.trialBalance') }
      ]
    },
    {
      key: 'g-reports',
      icon: <FileTextOutlined />,
      label: t('nav.group.reports'),
      children: [
        { key: '/bills', icon: <FileTextOutlined />, label: t('nav.bills') },
        { key: '/party', icon: <FilterOutlined />, label: t('nav.party') }
      ]
    },
    {
      key: 'g-admin',
      icon: <SettingOutlined />,
      label: t('nav.group.admin'),
      children: [
        { key: '/store', icon: <SettingOutlined />, label: t('nav.store') },
        { key: '/close', icon: <LockOutlined />, label: t('nav.close') },
        { key: '/audit', icon: <AuditOutlined />, label: t('nav.audit') }
      ]
    }
  ]

  const logout = async (): Promise<void> => {
    await window.api.auth.logout()
    setSession(null)
  }

  const toggleLang = useCallback((): void => {
    i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')
  }, [])

  useGlobalHotkeys(toggleLang)

  // Top-right chevron menu — per the landing sketch, only change-password and logout live here.
  const userMenu: MenuProps = {
    items: [
      { key: 'pw', icon: <KeyOutlined />, label: t('password.change') },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, danger: true, label: t('nav.logout') }
    ],
    onClick: ({ key }) => {
      if (key === 'pw') setPwOpen(true)
      else if (key === 'logout') void logout()
    }
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {/* Brand bar — title left, language toggle + user dropdown right */}
      <Header
        style={{
          background: palette.surfaceContainerLowest,
          borderBottom: `1px solid ${palette.outlineVariant}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingInline: 24,
          boxShadow: '0 1px 2px rgba(26,27,32,0.04)'
        }}
      >
        <Space size={12} align="center">
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: palette.primary,
              color: palette.onPrimary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              letterSpacing: '0.02em'
            }}
          >
            PC
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <Typography.Text strong style={{ fontSize: 16, color: palette.primary }}>
              {t('app.title')}
            </Typography.Text>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: palette.onSurfaceVariant,
                fontWeight: 600
              }}
            >
              {t('app.tagline')}
            </div>
          </div>
        </Space>

        <Space size="middle" align="center">
          <Button
            size="small"
            icon={<QuestionCircleOutlined />}
            title={t('shortcuts.tooltip')}
            onClick={() => window.dispatchEvent(new Event('hotkey:help'))}
          />
          <Button size="small" icon={<GlobalOutlined />} onClick={toggleLang}>
            {t('lang.toggle')}
          </Button>
          <Dropdown menu={userMenu} trigger={['click']} placement="bottomRight">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '4px 8px',
                borderRadius: 10,
                cursor: 'pointer'
              }}
            >
              <Avatar
                size={32}
                icon={<UserOutlined />}
                style={{ background: palette.primaryFixed, color: palette.primary }}
              />
              <div style={{ lineHeight: 1.15, textAlign: 'right' }}>
                <Typography.Text strong style={{ display: 'block' }}>
                  {session?.accountantName}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {session?.year}
                </Typography.Text>
              </div>
              <DownOutlined style={{ fontSize: 11, color: palette.onSurfaceVariant }} />
            </div>
          </Dropdown>
        </Space>
      </Header>

      {/* Section nav — grouped headers across the top */}
      <div
        style={{
          background: palette.surfaceContainerLowest,
          borderBottom: `1px solid ${palette.outlineVariant}`,
          paddingInline: 16,
          boxShadow: '0 1px 2px rgba(26,27,32,0.04)'
        }}
      >
        <Menu
          id="pc-top-nav"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => navigate(key)}
          style={{ borderBottom: 'none', background: 'transparent' }}
        />
      </div>

      <Content style={{ padding: 24, overflow: 'auto' }}>
        {session?.mustChangePassword && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('password.defaultWarning')}
            action={
              <Button size="small" type="primary" onClick={() => setPwOpen(true)}>
                {t('password.changeNow')}
              </Button>
            }
          />
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id" element={<AccountLedgerPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/aamad" element={<AamadPage />} />
            <Route path="/maps" element={<MapsPage />} />
            <Route path="/sauda" element={<SaudaPage />} />
            <Route path="/nikasi" element={<NikasiPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/cheques" element={<ChequesPage />} />
            <Route path="/bardana" element={<BardanaPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/bills" element={<BillsPage />} />
            <Route path="/bills/:accountId" element={<BillPage />} />
            <Route path="/party" element={<PartyPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/trial-balance" element={<TrialBalancePage />} />
            <Route path="/money-book" element={<MoneyBookPage />} />
            <Route path="/close" element={<ClosePage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/store" element={<StorePage />} />
          </Routes>
        </Content>
      <ChangePasswordModal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        onChanged={() => session && setSession({ ...session, mustChangePassword: false })}
      />
      <ShortcutsHelp />
    </Layout>
  )
}
