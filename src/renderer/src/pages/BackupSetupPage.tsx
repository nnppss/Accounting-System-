import { useState } from 'react'
import { App as AntApp, Button, Card, Input, Space, Typography } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'

/**
 * First-run setup, shown once before the login screen ever appears: pick the folder where
 * automatic database backups are kept (software.md §5). The folder is prefilled with
 * Documents/Paritosh Cold Backups; saving takes an immediate backup into it, so a bad choice
 * (unwritable disk, missing drive) is rejected on the spot rather than failing silently later.
 */
export default function BackupSetupPage({
  defaultDir,
  onDone
}: {
  defaultDir: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const [dir, setDir] = useState(defaultDir)

  const choose = async (): Promise<void> => {
    const picked = await window.api.backup.chooseDir()
    if (picked) setDir(picked)
  }

  const save = useMutation({
    mutationFn: () => window.api.backup.setDir(dir),
    onSuccess: () => {
      message.success(t('backup.setup.saved'))
      onDone()
    },
    onError: (e: Error) => message.error(`${t('backup.setup.failed')}: ${e.message}`)
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
          width: 460,
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

        <Typography.Title level={5}>{t('backup.setup.title')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('backup.setup.explain')}</Typography.Paragraph>

        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input value={dir} readOnly />
          <Button icon={<FolderOpenOutlined />} onClick={() => void choose()}>
            {t('backup.choose')}
          </Button>
        </Space.Compact>

        <Button type="primary" block loading={save.isPending} onClick={() => save.mutate()}>
          {t('backup.setup.save')}
        </Button>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('backup.setup.hint')}
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
