import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/**
 * Tally-style keyboard flow for a data-entry form.
 *
 * Spread the returned handlers on a <div> that *wraps* the antd <Form> (but not the
 * Modal footer's OK/Cancel buttons), and pass `open` (the modal/drawer visibility) plus
 * `onAccept` (usually `() => form.submit()`):
 *
 *   const nav = useFormKeyNav({ open, onAccept: () => form.submit() })
 *   <div ref={nav.containerRef} onKeyDownCapture={nav.onKeyDownCapture}>
 *     <Form …>…</Form>
 *   </div>
 *
 * Behaviour (matches Tally, confirmed with the user):
 *  - When the form opens, the first field is focused automatically.
 *  - Enter → move to the next field (does NOT submit).
 *  - Ctrl/Cmd+Enter, or Enter on the last field → accept/save.
 *  - In a <Form.List> grid, Enter past the last cell of the last line clicks the
 *    "add line" button (marked `data-pc-additem`) and lands on the new line's first cell.
 *  - When an antd Select/DatePicker panel is open, Enter is left to antd so it commits the
 *    selection — a second Enter then advances (the natural "pick, then move on" flow).
 *  - Shift+Enter in a <textarea> inserts a newline.
 *  - Tab / Shift+Tab move through the SAME field stops as Enter (one stop per compound
 *    control, never the inner bits); on the first/last field they fall back to native Tab
 *    so focus can reach the modal footer buttons.
 */

// antd compound controls render several inner nodes; we treat each as ONE field stop.
const GROUP_SEL =
  '.ant-select, .ant-picker, .ant-input-number, .ant-segmented, .ant-radio-group, .ant-checkbox-wrapper'

const CANDIDATE_SEL = `${GROUP_SEL}, input, textarea, button, [tabindex]`

interface Field {
  /** The de-duplicated field root (the antd group, or a bare input/button). */
  root: HTMLElement
  /** The element to actually move focus to. */
  target: HTMLElement
}

/** Is this element rendered (not display:none / detached)? */
function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

/** The field "root" for an element: its enclosing antd group, or the element itself. */
function fieldRoot(el: HTMLElement): HTMLElement {
  return (el.closest(GROUP_SEL) as HTMLElement | null) ?? el
}

/** Where focus should land for a given field root. */
function focusTarget(root: HTMLElement): HTMLElement {
  if (root.matches('input, textarea, button')) return root
  // Compound control — prefer the checked radio (Segmented / Radio.Group), else the input.
  const inner =
    root.querySelector<HTMLElement>('input:checked') ??
    root.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button')
  return inner ?? root
}

/** Ordered, de-duplicated list of focusable fields inside `container`, in document order. */
function collectFields(container: HTMLElement): Field[] {
  const seen = new Set<HTMLElement>()
  const out: Field[] = []
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(CANDIDATE_SEL))) {
    if (el.matches(':disabled')) continue
    if (el.getAttribute('type') === 'hidden') continue
    if (el.getAttribute('tabindex') === '-1') continue
    if (el.getAttribute('aria-hidden') === 'true') continue
    const root = fieldRoot(el)
    if (seen.has(root)) continue
    if (!isVisible(root)) continue
    seen.add(root)
    out.push({ root, target: focusTarget(root) })
  }
  return out
}

function focusField(field: Field | undefined): void {
  if (!field) return
  field.target.focus()
  // Select existing text so the next keystroke overtypes it (Tally-like).
  const t = field.target as HTMLInputElement
  if ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && typeof t.select === 'function') {
    try {
      t.select()
    } catch {
      /* some input types disallow select() */
    }
  }
}

function anyAntPanelOpen(): boolean {
  return !!(
    document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') ||
    document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)')
  )
}

export function useFormKeyNav({
  open = true,
  autoFocus = true,
  onAccept
}: {
  open?: boolean
  /** Focus the first field when the form opens (default true). Turn off when a page has
   *  several always-mounted inline forms that would otherwise fight over focus. */
  autoFocus?: boolean
  onAccept: () => void
}): {
  containerRef: RefObject<HTMLDivElement>
  onKeyDownCapture: (e: ReactKeyboardEvent<HTMLDivElement>) => void
} {
  const containerRef = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>
  const acceptRef = useRef(onAccept)
  acceptRef.current = onAccept

  // Land on the first field whenever the form becomes visible (after antd's open animation).
  useEffect(() => {
    if (!open || !autoFocus) return
    const id = window.setTimeout(() => {
      const c = containerRef.current
      if (!c) return
      focusField(collectFields(c)[0])
    }, 60)
    return () => window.clearTimeout(id)
  }, [open, autoFocus])

  const onKeyDownCapture = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return
    const target = e.target as HTMLElement

    // Let antd commit an open Select option / DatePicker date on Enter/Tab.
    if (anyAntPanelOpen()) return

    const container = containerRef.current
    if (!container) return

    // Tab / Shift+Tab → same stops as Enter, without the accept/add-line behaviour.
    if (e.key === 'Tab') {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const fields = collectFields(container)
      const curRoot = fieldRoot(target)
      const idx = fields.findIndex((f) => f.root === curRoot || f.root.contains(curRoot))
      if (idx < 0) return
      const next = fields[idx + (e.shiftKey ? -1 : 1)]
      if (!next) return // leaving the form → native Tab reaches the footer buttons
      e.preventDefault()
      focusField(next)
      return
    }

    // Allow newlines in a multiline field.
    if (target.tagName === 'TEXTAREA' && e.shiftKey) return
    // Enter on the "add line" button itself is a click, not a move.
    if (target.closest('[data-pc-additem]')) return

    // Ctrl/Cmd+Enter → accept from anywhere.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      acceptRef.current()
      return
    }

    e.preventDefault()
    const fields = collectFields(container)
    const curRoot = fieldRoot(target)
    const idx = fields.findIndex((f) => f.root === curRoot || f.root.contains(curRoot))
    const next = idx >= 0 ? fields[idx + 1] : fields[0]

    // No field after this one → accept (Enter on the last field saves).
    if (!next) {
      acceptRef.current()
      return
    }

    // Next stop is the "add line" button → add a row and jump into its first cell instead.
    const addBtn = next.target.closest('[data-pc-additem]') as HTMLElement | null
    if (addBtn) {
      addBtn.click()
      window.requestAnimationFrame(() => {
        const rows = container.querySelectorAll<HTMLElement>('[data-pc-row]')
        const lastRow = rows[rows.length - 1]
        if (lastRow) focusField(collectFields(lastRow)[0])
      })
      return
    }

    focusField(next)
  }, [])

  return { containerRef, onKeyDownCapture }
}
