import type { ThemeConfig } from 'antd'

/**
 * Shared Ant Design theme — the whole UI makeover lives here.
 *
 * Colours, fonts and radii are mapped from the Paritosh Cold design system so
 * that every antd surface (tables, forms, modals, buttons, tags, menus) picks
 * up the new look without any page having to change its markup or behaviour.
 */

// Design-system palette (Material 3 derived).
export const palette = {
  primary: '#008080', // teal — active nav, buttons, links
  primaryContainer: '#006666', // darker teal — hover/active
  primaryFixed: '#b2d8d8', // light teal — avatars / soft accents
  onPrimary: '#ffffff',
  success: '#419873', // green — positive balances
  error: '#ba1a1a', // red — danger: defaulters, irreversible actions
  errorContainer: '#fdf2f2', // faint red — danger row/surface tint
  warning: '#c77800', // amber — attention: accruing interest, pending items, exceptions
  warningContainer: '#fdf5e9', // faint amber — warning row/surface tint
  info: '#0086ad', // teal-blue — neutral information
  surface: '#e7eff6', // app background (soft cool)
  surfaceContainerLowest: '#ffffff', // cards / sider / header / boxes
  surfaceContainerLow: '#eef4fa', // table header / hover / subtle fills
  surfaceContainer: '#dde8f1',
  surfaceContainerHigh: '#cdddec',
  field: '#ffffff', // input controls
  onSurface: '#1f3344', // primary ink (dark slate)
  onSurfaceVariant: '#5b7385', // secondary text
  outline: '#90a4b3',
  outlineVariant: '#c9d8e6' // soft cool borders
} as const

const fontFamily =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const theme: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorInfo: palette.primary,
    colorSuccess: palette.success,
    colorError: palette.error,
    colorWarning: palette.warning,
    colorLink: palette.primary,
    colorBgLayout: palette.surface,
    colorBgContainer: palette.surfaceContainerLowest,
    colorBgElevated: palette.surfaceContainerLowest,
    colorBorder: palette.outlineVariant,
    colorBorderSecondary: palette.surfaceContainer,
    colorText: palette.onSurface,
    colorTextHeading: '#2a4d69',
    colorTextSecondary: palette.onSurfaceVariant,
    colorTextTertiary: palette.outline,
    fontFamily,
    borderRadius: 8,
    controlHeight: 36,
    wireframe: false
  },
  components: {
    Layout: {
      headerBg: palette.surfaceContainerLowest,
      siderBg: palette.surfaceContainerLowest,
      bodyBg: palette.surface,
      headerHeight: 64,
      headerPadding: '0 24px'
    },
    Menu: {
      itemBg: 'transparent',
      itemColor: palette.onSurfaceVariant,
      itemHoverBg: palette.surfaceContainer,
      itemHoverColor: palette.primary,
      itemSelectedBg: palette.primary,
      itemSelectedColor: palette.onPrimary,
      itemActiveBg: palette.surfaceContainer,
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemHeight: 40,
      iconSize: 18,
      fontSize: 14
    },
    Card: {
      borderRadiusLG: 14,
      colorBorderSecondary: palette.outlineVariant
    },
    Table: {
      headerBg: palette.surfaceContainerLow,
      headerColor: palette.onSurfaceVariant,
      headerSplitColor: 'transparent',
      rowHoverBg: palette.surfaceContainerLow,
      borderColor: palette.surfaceContainer,
      cellPaddingBlock: 12,
      headerBorderRadius: 0
    },
    Button: {
      borderRadius: 8,
      fontWeight: 600,
      primaryShadow: '0 2px 6px rgba(0,128,128,0.22)'
    },
    Input: { borderRadius: 8, colorBgContainer: palette.field },
    InputNumber: { borderRadius: 8, colorBgContainer: palette.field },
    Select: { borderRadius: 8, colorBgContainer: palette.field },
    Modal: { borderRadiusLG: 16 },
    Tag: { borderRadiusSM: 6 }
  }
}
