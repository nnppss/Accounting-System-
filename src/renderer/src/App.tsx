import { useState } from 'react'
import { Button, Card, Space, Typography, message } from 'antd'
import { useTranslation } from 'react-i18next'
import i18n from './i18n'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const [stored, setStored] = useState<string | null>(null)

  const toggleLang = (): void => {
    i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')
  }

  const ping = async (): Promise<void> => {
    const res = await window.api.ping('hello ' + Date.now())
    setStored(res.stored)
    message.success(`${t('phase0.stored')}: ${res.stored}`)
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('app.title')}
        </Typography.Title>
        <Button onClick={toggleLang}>{t('lang.toggle')}</Button>
      </Space>
      <Typography.Paragraph type="secondary">{t('app.tagline')}</Typography.Paragraph>
      <Card title={t('phase0.heading')} style={{ maxWidth: 480 }}>
        <Button type="primary" onClick={ping}>
          {t('phase0.ping')}
        </Button>
        {stored && (
          <Typography.Paragraph style={{ marginTop: 16 }}>
            {t('phase0.stored')}: <code>{stored}</code>
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  )
}
