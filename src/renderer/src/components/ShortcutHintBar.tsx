import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { palette } from '../theme'
import { Kbd } from './Kbd'

/** What kind of overlay (antd Modal/Drawer) is on screen right now. 'form' means it contains an
 * editable field, so the data-entry hints apply; 'view' is a read-only detail popup. */
type OverlayMode = 'none' | 'view' | 'form'

function overlayMode(): OverlayMode {
  const open: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>('.ant-modal-wrap')) {
    if (el.style.display !== 'none') open.push(el)
  }
  for (const el of document.querySelectorAll<HTMLElement>('.ant-drawer-open')) open.push(el)
  if (open.length === 0) return 'none'
  const hasField = open.some((el) =>
    el.querySelector('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')
  )
  return hasField ? 'form' : 'view'
}

/** Watches the DOM for antd modals/drawers opening or closing (they mount outside the React tree
 * we control here, so a MutationObserver is the simplest cross-page signal). */
function useOverlayMode(): OverlayMode {
  const [mode, setMode] = useState<OverlayMode>('none')

  useEffect(() => {
    let raf = 0
    const recheck = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setMode(overlayMode()))
    }
    const observer = new MutationObserver(recheck)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    })
    recheck()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  return mode
}

/** Pages whose “new entry” modal is wired to Ctrl+N (via useCreateHotkey) → their button label. */
const CREATE_LABEL: Record<string, string> = {
  accounts: 'accounts.new',
  aamad: 'aamad.new',
  sauda: 'sauda.new',
  nikasi: 'nikasi.new',
  loans: 'loans.new',
  cheques: 'cheques.new',
  bardana: 'bardana.new',
  expenses: 'expenses.new'
}

/** Pages with keyboard row-selection (useTableKeyNav). */
const LIST_PAGES = new Set([
  'accounts',
  'people',
  'aamad',
  'sauda',
  'nikasi',
  'loans',
  'cheques',
  'bardana',
  'expenses',
  'money-book',
  'vouchers',
  'trial-balance',
  'bills',
  'party',
  'audit'
])

function Hint({ keys, label }: { keys: ReactNode; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      {keys}
      <span>{label}</span>
    </span>
  )
}

/** One-line footer showing the shortcuts that apply right now: page-specific hints while
 * browsing, data-entry hints while a form modal/drawer is open. F1 still opens the full list. */
export default function ShortcutHintBar(): JSX.Element {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const mode = useOverlayMode()

  const segs = pathname.split('/').filter(Boolean)
  const section = segs[0] ?? 'home'
  const isDetail = segs.length > 1

  const hints: JSX.Element[] = []
  if (mode === 'form') {
    hints.push(
      <Hint key="next" keys={<Kbd small>Enter</Kbd>} label={t('shortcuts.bar.nextField')} />,
      <Hint key="line" keys={<Kbd small>Enter</Kbd>} label={t('shortcuts.bar.addLine')} />,
      <Hint
        key="save"
        keys={
          <>
            <Kbd small>Ctrl</Kbd>+<Kbd small>Enter</Kbd>
          </>
        }
        label={t('shortcuts.bar.save')}
      />,
      <Hint key="cancel" keys={<Kbd small>Esc</Kbd>} label={t('shortcuts.bar.cancel')} />
    )
  } else if (mode === 'view') {
    hints.push(<Hint key="close" keys={<Kbd small>Esc</Kbd>} label={t('shortcuts.bar.close')} />)
  } else {
    const createKey = isDetail ? undefined : CREATE_LABEL[section]
    if (createKey) {
      hints.push(
        <Hint
          key="new"
          keys={
            <>
              <Kbd small>Ctrl</Kbd>+<Kbd small>N</Kbd>
            </>
          }
          label={t(createKey)}
        />
      )
    }
    if (!isDetail && LIST_PAGES.has(section)) {
      hints.push(
        <Hint
          key="move"
          keys={
            <>
              <Kbd small>↑</Kbd>
              <Kbd small>↓</Kbd>
            </>
          }
          label={t('shortcuts.bar.move')}
        />,
        <Hint key="open" keys={<Kbd small>Enter</Kbd>} label={t('shortcuts.bar.open')} />
      )
    }
    hints.push(
      <span
        key="jump"
        role="button"
        tabIndex={-1}
        data-altnav-toggle
        onClick={() => window.dispatchEvent(new Event('hotkey:altnav'))}
        style={{ display: 'inline-flex', cursor: 'pointer' }}
      >
        <Hint
          keys={
            <>
              <Kbd small>Alt</Kbd>+<Kbd small>◌</Kbd>
            </>
          }
          label={t('shortcuts.bar.section')}
        />
      </span>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '4px 20px',
        borderTop: `1px solid ${palette.outlineVariant}`,
        background: palette.surfaceContainerLowest,
        fontSize: 12,
        color: palette.onSurfaceVariant,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {hints}
      <span
        role="button"
        tabIndex={-1}
        onClick={() => window.dispatchEvent(new Event('hotkey:help'))}
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        <Kbd small>F1</Kbd>
        <span>{t('shortcuts.bar.help')}</span>
      </span>
    </div>
  )
}
