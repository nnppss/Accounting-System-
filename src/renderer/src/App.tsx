import { HashRouter } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from './store/session'
import LoginPage from './pages/LoginPage'
import BackupSetupPage from './pages/BackupSetupPage'
import AppLayout from './components/AppLayout'

/** Two gates in front of the app shell: first-run backup setup (no backup folder chosen yet),
 * then auth (no session → login). */
export default function App(): JSX.Element | null {
  const session = useSession((s) => s.session)
  const backup = useQuery({
    queryKey: ['backup', 'settings'],
    queryFn: () => window.api.backup.settings()
  })

  if (!backup.data) return null // one frame while the settings load
  if (!backup.data.backupDir) {
    return <BackupSetupPage defaultDir={backup.data.defaultDir} onDone={() => void backup.refetch()} />
  }
  if (!session) return <LoginPage />
  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  )
}
