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

const NAV_MAP: Record<string, string> = {
  h: '/home',
  a: '/accounts',
  p: '/people',
  i: '/aamad',
  m: '/maps',
  n: '/nikasi',
  s: '/sauda',
  b: '/bardana',
  e: '/expenses',
  l: '/loans',
  q: '/cheques',
  k: '/money-book',
  v: '/vouchers',
  t: '/trial-balance',
  r: '/bills',
  f: '/party',
  o: '/store',
  y: '/close',
  u: '/audit'
}

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
