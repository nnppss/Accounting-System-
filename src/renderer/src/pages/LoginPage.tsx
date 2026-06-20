import { useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useSession } from '../store/session'
import { toPaise } from '../lib/format'

export default function LoginPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const setSession = useSession((s) => s.setSession)
  const queryClient = useQueryClient()
  const [showNewYear, setShowNewYear] = useState(false)

  const years = useQuery({ queryKey: ['years'], queryFn: () => window.api.auth.listYears() })

  const loginMut = useMutation({
    mutationFn: (v: { year: number; username: string; password: string }) =>
      window.api.auth.login(v.year, v.username, v.password),
    onSuccess: (session) => setSession(session),
    onError: (e: Error) => message.error(`${t('login.failed')}: ${e.message}`)
  })

  const createYearMut = useMutation({
    mutationFn: (v: { year: number; rentRate: number }) =>
      window.api.auth.createYear(v.year, toPaise(v.rentRate)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['years'] })
      setShowNewYear(false)
      message.success(t('login.createYear'))
    },
    onError: (e: Error) => message.error(e.message)
  })

  const yearOptions = (years.data ?? []).map((y) => ({ value: y.year, label: String(y.year) }))

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5'
      }}
    >
      <Card style={{ width: 380 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t('app.title')}
          </Typography.Title>
          <Button
            size="small"
            onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')}
          >
            {t('lang.toggle')}
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">{t('app.tagline')}</Typography.Paragraph>

        <Form layout="vertical" onFinish={(v) => loginMut.mutate(v)} initialValues={{ username: 'admin' }}>
          <Form.Item name="year" label={t('login.year')} rules={[{ required: true }]}>
            <Select options={yearOptions} loading={years.isLoading} placeholder={t('login.year')} />
          </Form.Item>
          <Form.Item name="username" label={t('login.username')} rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('login.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loginMut.isPending}>
            {t('login.submit')}
          </Button>
        </Form>

        <Divider style={{ margin: '16px 0' }} />
        {showNewYear ? (
          <Form layout="vertical" onFinish={(v) => createYearMut.mutate(v)}>
            <Form.Item name="year" label={t('login.year')} rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={2000} max={2100} />
            </Form.Item>
            <Form.Item name="rentRate" label={t('login.rentRate')}>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} addonBefore="₹" />
            </Form.Item>
            <Space>
              <Button htmlType="submit" type="primary" loading={createYearMut.isPending}>
                {t('login.createYear')}
              </Button>
              <Button onClick={() => setShowNewYear(false)}>{t('common.cancel')}</Button>
            </Space>
          </Form>
        ) : (
          <Button type="link" style={{ padding: 0 }} onClick={() => setShowNewYear(true)}>
            + {t('login.newYear')}
          </Button>
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('login.hint')}
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
