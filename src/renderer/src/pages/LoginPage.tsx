import { useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Space,
  Typography
} from 'antd'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useSession } from '../store/session'
import { toPaise } from '../lib/format'
import { useFormKeyNav } from '../lib/useFormKeyNav'

export default function LoginPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const setSession = useSession((s) => s.setSession)
  const [loginForm] = Form.useForm()
  const [showNewYear, setShowNewYear] = useState(false)
  const loginNav = useFormKeyNav({ onAccept: () => loginForm.submit() })

  const loginMut = useMutation({
    mutationFn: (v: { year: number; username: string; password: string; accountant: string }) =>
      window.api.auth.login(v.year, v.username, v.password, v.accountant),
    onSuccess: (session) => setSession(session),
    onError: (e: Error) => message.error(`${t('login.failed')}: ${e.message}`)
  })

  const createYearMut = useMutation({
    mutationFn: (v: { year: number; rentRate: number }) =>
      window.api.auth.createYear(v.year, toPaise(v.rentRate)),
    // Drop the user straight into the year they just created: prefill the sign-in Year field.
    onSuccess: (_id, vars) => {
      setShowNewYear(false)
      loginForm.setFieldsValue({ year: vars.year })
      message.success(t('login.createYear'))
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #b2d8d8 0%, #e7eff6 50%, #ffffff 100%)'
      }}
    >
      <Card
        style={{
          width: 380,
          borderRadius: 16,
          boxShadow: '0 12px 32px rgba(42,77,105,0.16)',
          border: '1px solid #c9d8e6'
        }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Title level={3} style={{ margin: 0, color: '#008080' }}>
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

        <div ref={loginNav.containerRef} onKeyDownCapture={loginNav.onKeyDownCapture}>
        <Form
          form={loginForm}
          layout="vertical"
          onFinish={(v) => loginMut.mutate(v)}
          initialValues={{ username: 'admin', year: new Date().getFullYear() }}
        >
          <Form.Item name="year" label={t('login.year')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={2000} max={2100} controls={false} />
          </Form.Item>
          <Form.Item name="username" label={t('login.username')} rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('login.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="accountant" label={t('login.accountant')} rules={[{ required: true }]}>
            <Input autoComplete="name" placeholder={t('login.accountantHint')} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loginMut.isPending}>
            {t('login.submit')}
          </Button>
        </Form>
        </div>

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
