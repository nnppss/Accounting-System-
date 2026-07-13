import { useRef } from 'react'
import { Modal } from 'antd'
import type { ModalProps } from 'antd'

/**
 * antd Modal, but the cursor lands in the first field when it opens so the keyboard
 * (typing, arrow keys) works without reaching for the mouse. `autoFocus` on inputs is
 * unreliable inside a Modal — the Modal's focus trap grabs focus after the field mounts —
 * so we focus after the open animation via `afterOpenChange`, which is the point the trap
 * has settled. Any caller-supplied `afterOpenChange` still runs.
 */
export default function AutoFocusModal({ afterOpenChange, children, ...rest }: ModalProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)

  const focusFirstField = (open: boolean): void => {
    afterOpenChange?.(open)
    if (!open) return
    const fields = bodyRef.current?.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
    // Skip anything hidden (e.g. a collapsed panel's field); offsetParent is null when not rendered.
    fields && Array.from(fields).find((el) => el.offsetParent !== null)?.focus()
  }

  return (
    <Modal {...rest} afterOpenChange={focusFirstField}>
      {/* display:contents so the wrapper adds no layout box */}
      <div ref={bodyRef} style={{ display: 'contents' }}>
        {children}
      </div>
    </Modal>
  )
}
