import type { ReactNode } from 'react'
import { palette } from '../theme'

/**
 * Shared "Rippling ledger" report chrome — the visual language lifted from the template zips:
 * a berry title banner, salmon section sub-bars, and colour-coded status pills. Pure presentation,
 * driven off `palette` in theme.ts so the whole set retints from one place.
 */

/** Berry page banner: white title on the primary colour, with optional subtitle and right-side actions. */
export function PageBanner({
  title,
  subtitle,
  extra
}: {
  title: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
}): JSX.Element {
  return (
    <div
      style={{
        background: palette.primary,
        color: palette.onPrimary,
        borderRadius: 10,
        padding: '12px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        boxShadow: '0 2px 8px rgba(74,0,57,0.18)'
      }}
    >
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {extra && (
        <div className="pc-banner-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {extra}
        </div>
      )}
    </div>
  )
}

/** Salmon section sub-bar introducing a block (e.g. "Assets", "Monthly Summary"). */
export function SectionBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: palette.section,
        color: '#3a2233',
        fontWeight: 700,
        fontSize: 13,
        padding: '6px 12px',
        borderRadius: 6,
        margin: '18px 0 8px',
        borderBottom: `2px solid ${palette.primary}`
      }}
    >
      {children}
    </div>
  )
}

export type PillTone = 'ok' | 'warn' | 'danger' | 'none' | 'info'

const PILL: Record<PillTone, { bg: string; fg: string }> = {
  ok: { bg: '#bae5d9', fg: '#0d674d' }, // On Track
  warn: { bg: '#fbe7bd', fg: '#8a5a00' }, // Near Limit
  danger: { bg: '#f7d0cb', fg: '#9c2318' }, // Over Budget
  none: { bg: palette.primaryFixed, fg: palette.primary }, // No Budget Set (berry)
  info: { bg: palette.surfaceContainerLow, fg: palette.onSurfaceVariant }
}

/** Rippling status pill — colour-coded state (On Track / Near Limit / Over Budget / No Budget). */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }): JSX.Element {
  const c = PILL[tone]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 10px',
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 12,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        background: c.bg,
        color: c.fg
      }}
    >
      {children}
    </span>
  )
}
