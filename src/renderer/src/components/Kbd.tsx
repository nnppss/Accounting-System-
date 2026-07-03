import type { ReactNode } from 'react'
import { palette } from '../theme'

/** A single keycap chip. `small` is the compact variant used by the footer hint bar. */
export function Kbd({ children, small }: { children: ReactNode; small?: boolean }): JSX.Element {
  return (
    <kbd
      style={{
        display: 'inline-block',
        minWidth: small ? 18 : 22,
        padding: small ? '0 5px' : '1px 7px',
        margin: '0 2px',
        textAlign: 'center',
        fontFamily: 'inherit',
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        lineHeight: small ? '16px' : '18px',
        color: palette.onSurfaceVariant,
        background: palette.surfaceContainerLowest,
        border: `1px solid ${palette.outlineVariant}`,
        borderBottomWidth: 2,
        borderRadius: small ? 5 : 6
      }}
    >
      {children}
    </kbd>
  )
}
