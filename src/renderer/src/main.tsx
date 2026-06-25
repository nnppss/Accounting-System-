import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './i18n'
import './styles.css'
import App from './App'
import { theme } from './theme'
import { useSession } from './store/session'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
})

function mount(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider theme={theme}>
          <AntApp>
            <App />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    </React.StrictMode>
  )
}

// The authoritative session lives in the main process; rehydrate it before first paint so a
// renderer reload returns to the app rather than the login screen.
window.api.auth
  .session()
  .then((s) => {
    if (s) useSession.getState().setSession(s)
  })
  .catch(() => {
    /* no session yet — the login screen handles it */
  })
  .finally(mount)
