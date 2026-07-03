import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function isModalOpen(): boolean {
  for (const el of document.querySelectorAll('.ant-modal-wrap')) {
    if ((el as HTMLElement).style.display !== 'none') return true
  }
  return false
}

/** Alt+letter section jumps, in top-nav order. Also drives the Alt-held hint overlay. */
export const NAV_HINTS: { key: string; route: string; labelKey: string }[] = [
  { key: 'h', route: '/home', labelKey: 'nav.home' },
  { key: 'a', route: '/accounts', labelKey: 'nav.accounts' },
  { key: 'p', route: '/people', labelKey: 'nav.people' },
  { key: 'i', route: '/aamad', labelKey: 'nav.aamad' },
  { key: 'm', route: '/maps', labelKey: 'nav.maps' },
  { key: 'n', route: '/nikasi', labelKey: 'nav.nikasi' },
  { key: 's', route: '/sauda', labelKey: 'nav.sauda' },
  { key: 'b', route: '/bardana', labelKey: 'nav.bardana' },
  { key: 'e', route: '/expenses', labelKey: 'nav.expenses' },
  { key: 'l', route: '/loans', labelKey: 'nav.loans' },
  { key: 'q', route: '/cheques', labelKey: 'nav.cheques' },
  { key: 'k', route: '/money-book', labelKey: 'nav.moneyBook' },
  { key: 'v', route: '/vouchers', labelKey: 'nav.vouchers' },
  { key: 't', route: '/trial-balance', labelKey: 'nav.trialBalance' },
  { key: 'r', route: '/bills', labelKey: 'nav.bills' },
  { key: 'f', route: '/party', labelKey: 'nav.party' },
  { key: 'o', route: '/store', labelKey: 'nav.store' },
  { key: 'd', route: '/backup', labelKey: 'nav.backup' },
  { key: 'y', route: '/close', labelKey: 'nav.close' },
  { key: 'u', route: '/audit', labelKey: 'nav.audit' }
]

const NAV_MAP: Record<string, string> = Object.fromEntries(
  NAV_HINTS.map((h) => [h.key, h.route])
)

export function useGlobalHotkeys(toggleLang: () => void): void {
  const navigate = useNavigate()
  const toggleRef = useRef(toggleLang)
  toggleRef.current = toggleLang

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey

      // Alt + letter → navigate (works even from inputs — Tally-style)
      if (e.altKey && !mod && !e.shiftKey) {
        const route = NAV_MAP[e.key.toLowerCase()]
        if (route) {
          e.preventDefault()
          navigate(route)
          return
        }
      }

      // Ctrl/Cmd + G → toggle language (works from anywhere)
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        toggleRef.current()
        return
      }

      // F1 → keyboard shortcuts help (works from anywhere, even mid-form)
      if (e.key === 'F1') {
        e.preventDefault()
        window.dispatchEvent(new Event('hotkey:help'))
        return
      }

      if (isInputFocused() || isModalOpen()) return

      // ? (Shift + /) → keyboard shortcuts help (only when not typing)
      if (e.key === '?') {
        e.preventDefault()
        window.dispatchEvent(new Event('hotkey:help'))
        return
      }

      // Esc → jump focus up to the top section nav (Home / Accounts / Stock / …). From there the
      // arrow keys move between groups and Enter opens one. A second Esc drops back to the page.
      // (Open modals/drawers and focused inputs are handled above, so this only fires on a page.)
      if (e.key === 'Escape') {
        const nav = document.getElementById('pc-top-nav')
        if (!nav) return
        if (nav.contains(document.activeElement)) {
          e.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur()
          return
        }
        const target = nav.querySelector<HTMLElement>(
          '.ant-menu-item-selected, .ant-menu-submenu-selected .ant-menu-submenu-title, [role="menuitem"]'
        )
        if (target) {
          e.preventDefault()
          target.focus()
          return
        }
      }

      // Ctrl/Cmd + N → create new (context-aware)
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        window.dispatchEvent(new Event('hotkey:create'))
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])
}

export function useCreateHotkey(open: () => void): void {
  const ref = useRef(open)
  ref.current = open

  useEffect(() => {
    const handler = (): void => ref.current()
    window.addEventListener('hotkey:create', handler)
    return () => window.removeEventListener('hotkey:create', handler)
  }, [])
}

/** Fires when the user asks for the shortcuts help (F1 or `?`). */
export function useHelpHotkey(open: () => void): void {
  const ref = useRef(open)
  ref.current = open

  useEffect(() => {
    const handler = (): void => ref.current()
    window.addEventListener('hotkey:help', handler)
    return () => window.removeEventListener('hotkey:help', handler)
  }, [])
}
