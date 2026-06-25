import { Card, Empty, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSession } from '../store/session'
import { palette } from '../theme'

/** Landing page shown after sign-in. The actual dashboard content is still being decided —
 * for now it's a welcome hero with a placeholder where widgets will go. */
export default function HomePage(): JSX.Element {
  const { t } = useTranslation()
  const session = useSession((s) => s.session)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        style={{
          background: `linear-gradient(135deg, ${palette.primaryFixed} 0%, ${palette.surfaceContainerLow} 60%, ${palette.surfaceContainerLowest} 100%)`,
          border: `1px solid ${palette.outlineVariant}`
        }}
      >
        <Typography.Title level={2} style={{ margin: 0, color: palette.primary }}>
          {t('home.title', { name: session?.accountantName })}
        </Typography.Title>
        <Typography.Text
          style={{
            fontSize: 13,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: palette.onSurfaceVariant,
            fontWeight: 600
          }}
        >
          {t('home.subtitle', { year: session?.year })}
        </Typography.Text>
      </Card>

      <Card style={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={t('home.placeholder')} />
      </Card>
    </div>
  )
}
