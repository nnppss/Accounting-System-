import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { palette } from '../theme'
import { NAV_HINTS } from '../lib/useHotkeys'
import { Kbd } from './Kbd'

/** The letter→section map, rising from the footer hint bar two ways:
 *  - held: while Alt is down (a beat, so quick Alt+letter jumps don't flash it);
 *  - pinned: toggled by the hint bar's “jump to section” chip (hotkey:altnav event);
 *    stays until Esc, a click elsewhere, or picking a section.
 *  Rendered inside a position:relative wrapper around the hint bar. Each entry is clickable. */
export default function AltNavOverlay(): JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [held, setHeld] = useState(false)
  const [pinned, setPinned] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: number | undefined
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && !e.repeat && timer === undefined) {
        timer = window.setTimeout(() => setHeld(true), 250)
      }
      if (e.key === 'Escape') setPinned(false)
    }
    const hideHeld = (): void => {
      window.clearTimeout(timer)
      timer = undefined
      setHeld(false)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') hideHeld()
    }
    const toggle = (): void => setPinned((p) => !p)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', hideHeld)
    window.addEventListener('hotkey:altnav', toggle)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', hideHeld)
      window.removeEventListener('hotkey:altnav', toggle)
    }
  }, [])

  // A click anywhere outside the pinned panel closes it. The footer chip that dispatched the
  // toggle is excluded (data-altnav-toggle), otherwise its own mousedown would close-then-reopen.
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (target?.closest('[data-altnav-toggle]')) return
      if (!panelRef.current?.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned])

  if (!held && !pinned) return null

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 16,
        rowGap: 8,
        padding: '10px 20px',
        background: palette.surfaceContainerLowest,
        borderTop: `1px solid ${palette.outlineVariant}`,
        boxShadow: '0 -6px 16px rgba(26,27,32,0.12)',
        fontSize: 12,
        color: palette.onSurfaceVariant,
        animation: 'pc-rise 0.15s ease-out'
      }}
    >
      <span style={{ fontWeight: 600, marginRight: 4 }}>
        <Kbd small>Alt</Kbd>+<Kbd small>◌</Kbd> {t('shortcuts.nav')}:
      </span>
      {NAV_HINTS.map((h) => (
        <span
          key={h.key}
          onClick={() => {
            setPinned(false)
            navigate(h.route)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
            cursor: 'pointer'
          }}
        >
          <Kbd small>{h.key.toUpperCase()}</Kbd>
          <span>{t(h.labelKey)}</span>
        </span>
      ))}
    </div>
  )
}
