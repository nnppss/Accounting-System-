import { HashRouter } from 'react-router-dom'
import { useSession } from './store/session'
import LoginPage from './pages/LoginPage'
import AppLayout from './components/AppLayout'

/** Auth gate: no session → login; otherwise the routed app shell. */
export default function App(): JSX.Element {
  const session = useSession((s) => s.session)
  if (!session) return <LoginPage />
  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  )
}
