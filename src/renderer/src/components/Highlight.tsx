import { Badge, Tag, Typography, type TagProps } from 'antd'
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  InfoCircleFilled,
  WarningFilled
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { CSSProperties, ReactNode } from 'react'
import { balanceLabel, balanceSentence, formatINR } from '../lib/format'
import { palette } from '../theme'

/**
 * Severity is the single vocabulary for "how much should this draw the eye". Call sites say *what a
 * thing is* (a defaulter is `danger`, accruing interest is `warning`) and this module decides the
 * look — colour, tag style, icon — by routing to the right antd primitive. Keeping the look in one
 * place means the whole app stays consistent and is tuned from here (and the theme tokens) alone.
 */
export type Severity = 'danger' | 'warning' | 'info' | 'success'

/** antd Typography.Text `type` per severity (`info` has no native type → plain ink). */
const TEXT_TYPE = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  info: undefined
} as const

/** antd Tag preset colour per severity — these render the subtle tinted-bg + coloured-border look. */
const TAG_COLOR: Record<Severity, string> = {
  danger: 'error',
  warning: 'warning',
  info: 'processing',
  success: 'success'
}

/** antd Badge `status` per severity, for the small status dot beside names. */
const BADGE_STATUS: Record<Severity, 'error' | 'warning' | 'processing' | 'success'> = {
  danger: 'error',
  warning: 'warning',
  info: 'processing',
  success: 'success'
}

/** Default icon per severity, used when a tag opts in with `icon`. */
const ICON: Record<Severity, ReactNode> = {
  danger: <ExclamationCircleFilled />,
  warning: <WarningFilled />,
  info: <InfoCircleFilled />,
  success: <CheckCircleFilled />
}

/** Coloured inline text — for figures and labels that should stand out in place (interest, dues). */
export function SeverityText({
  severity,
  strong,
  style,
  children
}: {
  severity: Severity
  strong?: boolean
  style?: CSSProperties
  children: ReactNode
}): JSX.Element {
  // `info` has no antd Text type, so colour it from the palette token directly.
  const resolved = severity === 'info' ? { color: palette.info, ...style } : style
  return (
    <Typography.Text type={TEXT_TYPE[severity]} strong={strong} style={resolved}>
      {children}
    </Typography.Text>
  )
}

/** A status label — defaulter, overdue, pending. `icon` adds the matching severity glyph. */
export function SeverityTag({
  severity,
  icon,
  style,
  children,
  ...rest
}: {
  severity: Severity
  icon?: boolean
  children: ReactNode
} & Omit<TagProps, 'color' | 'icon' | 'children'>): JSX.Element {
  return (
    <Tag color={TAG_COLOR[severity]} icon={icon ? ICON[severity] : undefined} style={style} {...rest}>
      {children}
    </Tag>
  )
}

/** A small status dot, e.g. beside a party name in a list. */
export function SeverityDot({ severity }: { severity: Severity }): JSX.Element {
  return <Badge status={BADGE_STATUS[severity]} />
}

/** Table `rowClassName` token for a faint full-row tint (paired with CSS in styles.css). */
export function severityRowClass(severity: Severity | null | undefined): string {
  return severity ? `pc-row-${severity}` : ''
}

/**
 * Shared rule: is a loan/dues figure carrying interest worth flagging? Interest quietly growing on
 * an unpaid balance is the classic "important thing" the accountant must not miss → `warning`.
 */
export function interestSeverity(interestPaise: number): Severity | null {
  return interestPaise > 0 ? 'warning' : null
}

/**
 * Direction-coded severity for a ledger balance. Sign follows the ledger convention used across the
 * app: positive (Dr) means the party owes the cold — a receivable to chase, so `warning` (amber);
 * negative (Cr) means the cold owes the party — a payable, shown as neutral `info` (teal); zero is
 * a `success` (settled). Muted on purpose, so a balance reads as *directional*, never alarming.
 */
export function balanceSeverity(paise: number): Severity {
  if (paise > 0) return 'warning'
  if (paise < 0) return 'info'
  return 'success'
}

/** A ledger balance rendered the accountant's way (amount + Dr/Cr) with direction-coded emphasis. */
export function BalanceAmount({
  paise,
  strong,
  style
}: {
  paise: number
  strong?: boolean
  style?: CSSProperties
}): JSX.Element {
  return (
    <SeverityText severity={balanceSeverity(paise)} strong={strong} style={style}>
      {balanceLabel(paise)}
    </SeverityText>
  )
}

/**
 * The plain-language balance line ("X owes the cold ₹…") with only the *amount* highlighted, so the
 * money jumps out while the sentence stays readable. Falls back to plain text if the amount can't be
 * located in the localised string (defensive — keeps the sentence intact whatever the translation).
 */
export function BalanceSentence({ name, paise }: { name: string; paise: number }): JSX.Element {
  const { t } = useTranslation()
  const sentence = balanceSentence(t, name, paise)
  const amount = formatINR(Math.abs(paise))
  const at = sentence.indexOf(amount)
  if (paise === 0 || at === -1) {
    return <Typography.Text>{sentence}</Typography.Text>
  }
  return (
    <Typography.Text>
      {sentence.slice(0, at)}
      <SeverityText severity={balanceSeverity(paise)} strong>
        {amount}
      </SeverityText>
      {sentence.slice(at + amount.length)}
    </Typography.Text>
  )
}
