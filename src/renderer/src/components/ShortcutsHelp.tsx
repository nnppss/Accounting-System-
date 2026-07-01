import { useState, type ReactNode } from 'react'
import { Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useHelpHotkey } from '../lib/useHotkeys'
import { palette } from '../theme'

/** A single keycap chip. */
function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd
      style={{
        display: 'inline-block',
        minWidth: 22,
        padding: '1px 7px',
        margin: '0 2px',
        textAlign: 'center',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '18px',
        color: palette.onSurfaceVariant,
        background: palette.surfaceContainerLowest,
        border: `1px solid ${palette.outlineVariant}`,
        borderBottomWidth: 2,
        borderRadius: 6
      }}
    >
      {children}
    </kbd>
  )
}

interface Row {
  keys: ReactNode
  descKey: string
}

const GROUPS: { titleKey: string; rows: Row[] }[] = [
  {
    titleKey: 'shortcuts.group.global',
    rows: [
      { keys: <><Kbd>Alt</Kbd> + <Kbd>◌</Kbd></>, descKey: 'shortcuts.nav' },
      { keys: <><Kbd>Ctrl</Kbd> + <Kbd>N</Kbd></>, descKey: 'shortcuts.new' },
      { keys: <><Kbd>Ctrl</Kbd> + <Kbd>G</Kbd></>, descKey: 'shortcuts.lang' },
      { keys: <><Kbd>F1</Kbd> / <Kbd>?</Kbd></>, descKey: 'shortcuts.help' },
      { keys: <Kbd>Esc</Kbd>, descKey: 'shortcuts.back' },
      { keys: <><Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↓</Kbd></>, descKey: 'shortcuts.navMenu' }
    ]
  },
  {
    titleKey: 'shortcuts.group.lists',
    rows: [
      { keys: <><Kbd>↑</Kbd> <Kbd>↓</Kbd></>, descKey: 'shortcuts.rowMove' },
      { keys: <><Kbd>Home</Kbd> / <Kbd>End</Kbd></>, descKey: 'shortcuts.rowJump' },
      { keys: <><Kbd>PgUp</Kbd> / <Kbd>PgDn</Kbd></>, descKey: 'shortcuts.rowPage' },
      { keys: <Kbd>Enter</Kbd>, descKey: 'shortcuts.open' },
      { keys: <Kbd>Esc</Kbd>, descKey: 'shortcuts.clearSel' }
    ]
  },
  {
    titleKey: 'shortcuts.group.forms',
    rows: [
      { keys: <Kbd>Enter</Kbd>, descKey: 'shortcuts.nextField' },
      { keys: <><Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd></>, descKey: 'shortcuts.save' },
      { keys: <Kbd>Enter</Kbd>, descKey: 'shortcuts.addLine' },
      { keys: <Kbd>Esc</Kbd>, descKey: 'shortcuts.cancel' }
    ]
  }
]

/** Keyboard-shortcuts cheat sheet. Opened from anywhere by F1 or `?` (see useHotkeys). */
export default function ShortcutsHelp(): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useHelpHotkey(() => setOpen(true))

  return (
    <Modal
      open={open}
      title={t('shortcuts.title')}
      footer={null}
      onCancel={() => setOpen(false)}
      width={560}
    >
      <div style={{ display: 'grid', gap: 18, marginTop: 8 }}>
        {GROUPS.map((g) => (
          <div key={g.titleKey}>
            <Typography.Text
              strong
              style={{
                display: 'block',
                marginBottom: 8,
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: palette.onSurfaceVariant
              }}
            >
              {t(g.titleKey)}
            </Typography.Text>
            <div style={{ display: 'grid', gap: 6 }}>
              {g.rows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16
                  }}
                >
                  <div style={{ whiteSpace: 'nowrap' }}>{r.keys}</div>
                  <Typography.Text type="secondary" style={{ textAlign: 'right' }}>
                    {t(r.descKey)}
                    {r.descKey === 'shortcuts.nav' && (
                      <div style={{ fontSize: 11 }}>{t('shortcuts.navHint')}</div>
                    )}
                  </Typography.Text>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
