import type { ThemeConfig } from 'antd'

/**
 * Shared Ant Design theme — the whole UI makeover lives here.
 *
 * Colours, fonts and radii are mapped from the Paritosh Cold design system so
 * that every antd surface (tables, forms, modals, buttons, tags, menus) picks
 * up the new look without any page having to change its markup or behaviour.
 */

// Design-system palette — Rippling "berry" ledger family (see the template zips).
// Berry #7a005d headers, deep-green positives, salmon section bars, colour-coded status pills.
export const palette = {
  primary: '#7a005d', // berry — active nav, buttons, links, banners
  primaryContainer: '#5c0046', // darker berry — hover/active
  primaryFixed: '#eab8f2', // light purple — avatars / soft accents
  onPrimary: '#ffffff',
  section: '#f3c7ba', // salmon — Rippling section sub-bars
  success: '#0d674d', // deep green — positive balances / "On Track"
  error: '#ba1a1a', // red — danger: defaulters, "Over Budget", irreversible actions
  errorContainer: '#fbe9ef', // faint berry-red — danger row/surface tint
  warning: '#b5710a', // amber/gold — attention: accruing interest, "Near Limit", exceptions
  warningContainer: '#fbf1dc', // faint gold — warning row/surface tint
  info: '#7a005d', // folded into berry — neutral information
  surface: '#f7f3f6', // app background (soft warm-neutral)
  surfaceContainerLowest: '#ffffff', // cards / sider / header / boxes
  surfaceContainerLow: '#f5e9f3', // table header / hover / subtle fills (soft lilac)
  surfaceContainer: '#ecdcea',
  surfaceContainerHigh: '#e3cde0',
  field: '#ffffff', // input controls
  onSurface: '#2a1c27', // primary ink (warm dark)
  onSurfaceVariant: '#7a6a75', // secondary text
  outline: '#b79caf',
  outlineVariant: '#e3d3de' // soft warm borders
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
    colorTextHeading: '#4a0039',
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
      headerColor: palette.primary,
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
