import { useState } from 'react'
import { Modal, Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuickHotkey } from '../lib/useHotkeys'

/**
 * Ctrl/Cmd+K quick-entry launcher. During a fast dictation blast the next slip could be any
 * document type, so switching tabs first is the bottleneck. This opens a searchable list over
 * whatever page you're on; picking a document navigates to it and opens its entry form directly:
 *  - Receipt/Payment/Contra/Journal → the Vouchers form, pre-set to that mode.
 *  - Everything else → its page's existing "new" modal (via the shared `hotkey:create` event,
 *    re-fired from AppLayout once the destination page has mounted).
 * Reuses every existing form as-is — nothing is rebuilt.
 */
type Entry = { key: string; labelKey: string; route: string; mode?: string }

const ENTRIES: Entry[] = [
  { key: 'receipt', labelKey: 'vouchers.receipt', route: '/vouchers', mode: 'receipt' },
  { key: 'payment', labelKey: 'vouchers.payment', route: '/vouchers', mode: 'payment' },
  { key: 'contra', labelKey: 'vouchers.contra', route: '/vouchers', mode: 'contra' },
  { key: 'journal', labelKey: 'vouchers.journal', route: '/vouchers', mode: 'journal' },
  { key: 'cheque', labelKey: 'nav.cheques', route: '/cheques' },
  { key: 'loan', labelKey: 'nav.loans', route: '/loans' },
  { key: 'aamad', labelKey: 'nav.aamad', route: '/aamad' },
  { key: 'nikasi', labelKey: 'nav.nikasi', route: '/nikasi' },
  { key: 'sauda', labelKey: 'nav.sauda', route: '/sauda' },
  { key: 'bardana', labelKey: 'nav.bardana', route: '/bardana' },
  { key: 'expense', labelKey: 'nav.expenses', route: '/expenses' },
  { key: 'account', labelKey: 'nav.accounts', route: '/accounts' }
]

export default function QuickEntry(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  useQuickHotkey(() => setOpen(true))

  const pick = (key: string): void => {
    const e = ENTRIES.find((x) => x.key === key)
    if (!e) return
    setOpen(false)
    navigate(e.route, { state: e.mode ? { voucherMode: e.mode } : { quickCreate: true } })
  }

  return (
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} destroyOnClose title={t('quick.title')} width={460}>
      <Select
        autoFocus
        open
        showSearch
        placeholder={t('quick.placeholder')}
        optionFilterProp="label"
        // The always-open Select swallows Esc (rc-select stops propagation), so the Modal
        // would never see it — close the launcher ourselves.
        onInputKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{ width: '100%' }}
        options={ENTRIES.map((e) => ({ value: e.key, label: t(e.labelKey) }))}
        onSelect={(k) => pick(k as string)}
        getPopupContainer={(n) => n.parentElement as HTMLElement}
      />
    </Modal>
  )
}
