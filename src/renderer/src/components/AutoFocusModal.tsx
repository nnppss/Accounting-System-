import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Button, Modal } from 'antd'
import type { ModalProps } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props extends ModalProps {
  /** When set, the footer grows a "Save & new" button (Ctrl/Cmd+Shift+Enter fires it too).
   *  The caller saves as usual but re-opens a blank form instead of closing — the flow for
   *  entering ten aamads in a row. Leave undefined while editing, where it makes no sense. */
  onOkAndNew?: () => void
}

/**
 * antd Modal, but the cursor lands in the first field when it opens so the keyboard
 * (typing, arrow keys) works without reaching for the mouse. `autoFocus` on inputs is
 * unreliable inside a Modal — the Modal's focus trap grabs focus after the field mounts —
 * so we focus after the open animation via `afterOpenChange`, which is the point the trap
 * has settled. Any caller-supplied `afterOpenChange` still runs.
 */
export default function AutoFocusModal({
  afterOpenChange,
  onOkAndNew,
  children,
  ...rest
}: Props): JSX.Element {
  const { t } = useTranslation()
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

  // Capture on the outer wrapper so this beats useFormKeyNav's handler, which takes any
  // Ctrl+Enter as a plain save.
  const onKeyDownCapture = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!onOkAndNew) return
    if (e.key !== 'Enter' || !e.shiftKey || !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    e.stopPropagation()
    onOkAndNew()
  }

  // Only override `footer` when there's a button to add — a caller's own footer (including
  // `footer={null}` to hide it) must otherwise pass through untouched.
  const footerProps: Pick<ModalProps, 'footer'> | undefined = onOkAndNew && {
    footer: (_node, { OkBtn, CancelBtn }) => (
      <>
        <CancelBtn />
        <Button onClick={onOkAndNew} loading={rest.confirmLoading}>
          {t('common.saveAndNew')}
        </Button>
        <OkBtn />
      </>
    )
  }

  return (
    <Modal {...rest} {...footerProps} afterOpenChange={focusFirstField}>
      {/* display:contents so the wrapper adds no layout box */}
      <div ref={bodyRef} style={{ display: 'contents' }} onKeyDownCapture={onKeyDownCapture}>
        {children}
      </div>
    </Modal>
  )
}
