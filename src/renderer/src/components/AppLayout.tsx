import { Button, Layout, Menu, Space, Typography } from 'antd'
import {
  AppstoreOutlined,
  BankOutlined,
  BookOutlined,
  CreditCardOutlined,
  DollarOutlined,
  ExportOutlined,
  FileDoneOutlined,
  InboxOutlined,
  LogoutOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined
} from '@ant-design/icons'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useSession } from '../store/session'
import AccountsPage from '../pages/AccountsPage'
import AccountLedgerPage from '../pages/AccountLedgerPage'
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
import StorePage from '../pages/StorePage'

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
    { key: '/aamad', icon: <InboxOutlined />, label: t('nav.aamad') },
    { key: '/maps', icon: <AppstoreOutlined />, label: t('nav.maps') },
    { key: '/sauda', icon: <FileDoneOutlined />, label: t('nav.sauda') },
    { key: '/nikasi', icon: <ExportOutlined />, label: t('nav.nikasi') },
    { key: '/loans', icon: <DollarOutlined />, label: t('nav.loans') },
    { key: '/cheques', icon: <CreditCardOutlined />, label: t('nav.cheques') },
    { key: '/bardana', icon: <ShoppingOutlined />, label: t('nav.bardana') },
    { key: '/expenses', icon: <ToolOutlined />, label: t('nav.expenses') },
    { key: '/vouchers', icon: <BankOutlined />, label: t('nav.vouchers') },
    { key: '/trial-balance', icon: <BookOutlined />, label: t('nav.trialBalance') },
    { key: '/money-book', icon: <WalletOutlined />, label: t('nav.moneyBook') },
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
      <Sider theme="light" width={220} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px 20px' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('app.title')}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('app.tagline')}
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingInline: 24
          }}
        >
          <Space size="large">
            <Typography.Text strong>{session?.year}</Typography.Text>
            <Typography.Text type="secondary">{session?.accountantName}</Typography.Text>
            <Button size="small" onClick={toggleLang}>
              {t('lang.toggle')}
            </Button>
            <Button size="small" icon={<LogoutOutlined />} onClick={logout}>
              {t('nav.logout')}
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/accounts" replace />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id" element={<AccountLedgerPage />} />
            <Route path="/aamad" element={<AamadPage />} />
            <Route path="/maps" element={<MapsPage />} />
            <Route path="/sauda" element={<SaudaPage />} />
            <Route path="/nikasi" element={<NikasiPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/cheques" element={<ChequesPage />} />
            <Route path="/bardana" element={<BardanaPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/trial-balance" element={<TrialBalancePage />} />
            <Route path="/money-book" element={<MoneyBookPage />} />
            <Route path="/store" element={<StorePage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
