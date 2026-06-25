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

      if (isInputFocused() || isModalOpen()) return

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
