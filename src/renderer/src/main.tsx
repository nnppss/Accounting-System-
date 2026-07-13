import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import hiIN from 'antd/locale/hi_IN'
import 'dayjs/locale/hi' // month/weekday names for the Hindi date picker (loads data only; default locale stays en)
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import './i18n'
import './styles.css'
import App from './App'
import { theme } from './theme'
import { useSession } from './store/session'

/** Inside <AntApp> so failed reads can toast. A page whose query throws would otherwise just show
 * an empty table with no explanation. One key so a burst of failures collapses into one toast. */
function QueryRoot({ children }: { children: React.ReactNode }): JSX.Element {
  const { message } = AntApp.useApp()
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (e) => message.error({ content: (e as Error).message, key: 'query-error' })
        }),
        defaultOptions: { queries: { refetchOnWindowFocus: false } }
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Re-renders on language toggle so antd's own strings (pagination, empty states, date pickers,
 * default OK/Cancel) follow the app language instead of staying English in Hindi mode. */
function Root(): JSX.Element {
  const { i18n } = useTranslation()
  return (
    <ConfigProvider theme={theme} locale={i18n.language === 'hi' ? hiIN : enUS}>
      <AntApp>
        <QueryRoot>
          <App />
        </QueryRoot>
      </AntApp>
    </ConfigProvider>
  )
}

function mount(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
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
