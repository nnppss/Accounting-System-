import { useEffect, useRef } from 'react'
import type { FormInstance } from 'antd'

/**
 * System narrations. The app auto-writes a legible narration for most documents; these builders
 * produce the same for the hand-entered screens (Vouchers, Expenses, Loans) so the accountant
 * starts from a sensible line instead of a blank box — and can still edit it before posting.
 * Kept in English to match the module-raised narrations (e.g. "Bhada (rent) — 40 packets …").
 */

const withTag = (base: string, tagLabel?: string): string =>
  tagLabel ? `${base} (${tagLabel})` : base

export const receiptNarration = (party?: string, tagLabel?: string): string =>
  party ? withTag(`Received from ${party}`, tagLabel) : ''

export const paymentNarration = (party?: string, tagLabel?: string): string =>
  party ? withTag(`Paid to ${party}`, tagLabel) : ''

export const contraNarration = (from?: string, to?: string): string =>
  from && to ? `Transfer ${from} → ${to}` : ''

/** Expenses: "<head> — <party>", e.g. "Staff salary — Ramesh". */
export const expenseNarration = (head: string, party?: string): string =>
  party ? `${head} — ${party}` : ''

export const loanNarration = (party?: string): string => (party ? `Loan to ${party}` : '')

/**
 * Decide the next narration while an auto-suggestion tracks the form. We overwrite only while the
 * field is still "ours": empty, or exactly the last suggestion we wrote. Once the accountant types
 * anything else, we back off (return null) and never clobber their edit. Clearing the box hands
 * control back to auto. Pure so it's trivially testable; the hook below is a thin wrapper.
 */
export function nextNarration(
  current: string,
  lastSuggestion: string,
  suggestion: string
): string | null {
  if (current !== '' && current !== lastSuggestion) return null
  return suggestion
}

/**
 * Keep an antd form field prefilled with `suggestion` until the user edits it. Recomputes whenever
 * `suggestion` changes (pass a memoised string built from the watched form fields). After a
 * resetFields() the box is empty again, so auto-fill naturally resumes.
 */
export function useAutoNarration(
  form: FormInstance,
  suggestion: string,
  field = 'narration'
): void {
  const lastRef = useRef('')
  useEffect(() => {
    const current = ((form.getFieldValue(field) as string | undefined) ?? '').trim()
    const next = nextNarration(current, lastRef.current, suggestion)
    if (next === null) return
    lastRef.current = next
    form.setFieldValue(field, next || undefined)
  }, [suggestion, form, field])
}
