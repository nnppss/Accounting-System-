import { App as AntApp, Button, Card, Input, Space, Table, Tag, Typography } from 'antd'
import { FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { BackupFileRow, BackupReason } from '@shared/contracts'

/** Reason → tag colour; the tag text is localized (backup.reason.*). */
const REASON_COLOR: Record<BackupReason, string> = {
  setup: 'blue',
  open: 'default',
  quit: 'default',
  'pre-close': 'gold',
  manual: 'green'
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Admin › Backup — where the folder chosen at first-run setup can be changed, a backup taken
 * on demand, and every copy in the folder reviewed. Restoring is deliberately manual (copy a
 * backup over the live .db with the app closed), so this page only reads and creates files.
 */
export default function BackupPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: ['backup', 'settings'],
    queryFn: () => window.api.backup.settings()
  })
  const backups = useQuery({ queryKey: ['backup', 'list'], queryFn: () => window.api.backup.list() })
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['backup'] })
  }

  const changeDir = useMutation({
    mutationFn: async () => {
      const picked = await window.api.backup.chooseDir()
      if (!picked) return null
      return window.api.backup.setDir(picked)
    },
    onSuccess: (name) => {
      if (name === null) return // picker cancelled
      message.success(t('backup.setup.saved'))
      refresh()
    },
    onError: (e: Error) => message.error(`${t('backup.setup.failed')}: ${e.message}`)
  })

  const backupNow = useMutation({
    mutationFn: () => window.api.backup.now(),
    onSuccess: (name) => {
      message.success(t('backup.done', { name }))
      refresh()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const columns = [
    {
      title: t('backup.col.file'),
      dataIndex: 'fileName',
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>
    },
    {
      title: t('backup.col.reason'),
      dataIndex: 'reason',
      width: 160,
      render: (r: BackupReason) => <Tag color={REASON_COLOR[r]}>{t(`backup.reason.${r}`)}</Tag>
    },
    {
      title: t('backup.col.when'),
      dataIndex: 'modifiedAt',
      width: 170,
      render: (ms: number) => dayjs(ms).format('DD/MM/YYYY HH:mm')
    },
    {
      title: t('backup.col.size'),
      dataIndex: 'sizeBytes',
      width: 110,
      align: 'right' as const,
      render: formatSize
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('nav.backup')}
      </Typography.Title>

      <Card title={t('backup.folder')} style={{ maxWidth: 720, marginBottom: 24 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input value={settings.data?.backupDir ?? ''} readOnly />
          <Button loading={changeDir.isPending} onClick={() => changeDir.mutate()}>
            {t('backup.change')}
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={() => void window.api.backup.openFolder()}
          >
            {t('backup.openFolder')}
          </Button>
        </Space.Compact>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('backup.note')}
        </Typography.Paragraph>
      </Card>

      <Card
        title={t('backup.list')}
        style={{ maxWidth: 960 }}
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={backupNow.isPending}
            onClick={() => backupNow.mutate()}
          >
            {t('backup.now')}
          </Button>
        }
      >
        <Table<BackupFileRow>
          rowKey="fileName"
          size="small"
          columns={columns}
          dataSource={backups.data ?? []}
          loading={backups.isLoading}
          pagination={{ defaultPageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: t('backup.empty') }}
        />
      </Card>
    </div>
  )
}
