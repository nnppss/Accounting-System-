import { Avatar, Button, Layout, Menu, Space, Typography } from 'antd'
import {
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  CreditCardOutlined,
  DollarOutlined,
  ExportOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FilterOutlined,
  GlobalOutlined,
  IdcardOutlined,
  InboxOutlined,
  LockOutlined,
  LogoutOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WalletOutlined
} from '@ant-design/icons'
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
import { palette } from '../theme'

const { Header, Sider, Content } = Layout

export default function AppLayout(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession((s) => s.session)
  const setSession = useSession((s) => s.setSession)

  const selectedKey = '/' + (location.pathname.split('/')[1] || 'accounts')

  const items = [
    { key: '/accounts', icon: <TeamOutlined />, label: t('nav.accounts') },
    { key: '/people', icon: <IdcardOutlined />, label: t('nav.people') },
    { key: '/aamad', icon: <InboxOutlined />, label: t('nav.aamad') },
    { key: '/maps', icon: <AppstoreOutlined />, label: t('nav.maps') },
    { key: '/sauda', icon: <FileDoneOutlined />, label: t('nav.sauda') },
    { key: '/nikasi', icon: <ExportOutlined />, label: t('nav.nikasi') },
    { key: '/loans', icon: <DollarOutlined />, label: t('nav.loans') },
    { key: '/cheques', icon: <CreditCardOutlined />, label: t('nav.cheques') },
    { key: '/bardana', icon: <ShoppingOutlined />, label: t('nav.bardana') },
    { key: '/expenses', icon: <ToolOutlined />, label: t('nav.expenses') },
    { key: '/bills', icon: <FileTextOutlined />, label: t('nav.bills') },
    { key: '/party', icon: <FilterOutlined />, label: t('nav.party') },
    { key: '/vouchers', icon: <BankOutlined />, label: t('nav.vouchers') },
    { key: '/trial-balance', icon: <BookOutlined />, label: t('nav.trialBalance') },
    { key: '/money-book', icon: <WalletOutlined />, label: t('nav.moneyBook') },
    { key: '/close', icon: <LockOutlined />, label: t('nav.close') },
    { key: '/audit', icon: <AuditOutlined />, label: t('nav.audit') },
    { key: '/store', icon: <SettingOutlined />, label: t('nav.store') }
  ]

  const logout = async (): Promise<void> => {
    await window.api.auth.logout()
    setSession(null)
  }

  const toggleLang = (): void => {
    i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        theme="light"
        width={240}
        style={{ borderRight: `1px solid ${palette.outlineVariant}`, height: '100vh' }}
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
        {/* Brand block */}
        <div style={{ padding: '20px 24px 16px' }}>
          <Typography.Title level={4} style={{ margin: 0, color: palette.primary }}>
            {t('app.title')}
          </Typography.Title>
          <Typography.Text
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: palette.onSurfaceVariant,
              fontWeight: 600
            }}
          >
            {t('app.tagline')}
          </Typography.Text>
        </div>
        {/* Scrollable nav */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={items}
            onClick={({ key }) => navigate(key)}
            style={{ borderInlineEnd: 'none', background: 'transparent' }}
          />
        </div>
        {/* Session card pinned to the bottom */}
        <div style={{ padding: 12, borderTop: `1px solid ${palette.outlineVariant}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              background: palette.surfaceContainerLow,
              border: `1px solid ${palette.surfaceContainer}`,
              borderRadius: 12
            }}
          >
            <Avatar
              size={40}
              icon={<UserOutlined />}
              style={{ background: palette.primaryFixed, color: palette.primary }}
            />
            <div style={{ minWidth: 0 }}>
              <Typography.Text strong style={{ display: 'block', lineHeight: 1.2 }} ellipsis>
                {session?.accountantName}
              </Typography.Text>
              <Typography.Text
                style={{
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: palette.onSurfaceVariant,
                  fontWeight: 600
                }}
              >
                {session?.year}
              </Typography.Text>
            </div>
          </div>
        </div>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: palette.surfaceContainerLowest,
            borderBottom: `1px solid ${palette.outlineVariant}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingInline: 24,
            boxShadow: '0 1px 2px rgba(26,27,32,0.04)'
          }}
        >
          <Space size="middle" align="center">
            <Space size={6} align="center">
              <Typography.Text strong>{session?.accountantName}</Typography.Text>
              <Typography.Text type="secondary">· {session?.year}</Typography.Text>
            </Space>
            <Button size="small" icon={<GlobalOutlined />} onClick={toggleLang}>
              {t('lang.toggle')}
            </Button>
            <Button size="small" danger icon={<LogoutOutlined />} onClick={logout}>
              {t('nav.logout')}
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/accounts" replace />} />
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
      </Layout>
    </Layout>
  )
}
