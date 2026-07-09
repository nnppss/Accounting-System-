/** Shared guards for global key handlers — one definition so every hook/page agrees on
 * when the keyboard belongs to an input, an overlay, or the top nav. */

export function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

/** Any antd Modal OR Drawer currently on screen. */
export function isOverlayOpen(): boolean {
  for (const el of document.querySelectorAll('.ant-modal-wrap')) {
    if ((el as HTMLElement).style.display !== 'none') return true
  }
  return !!document.querySelector('.ant-drawer-open')
}

/** When focus is on the top section nav, its arrow keys drive the menu, not the page. */
export function isNavFocused(): boolean {
  return !!document.activeElement?.closest('#pc-top-nav')
}
