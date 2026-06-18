import { Platform } from 'react-native'

export const Colors = {
  brand: '#fbbf24',
  background: '#0a0a0a',
  card: '#171717',
  border: '#262626',
  borderFocus: '#404040',
  text: '#f5f5f5',
  textSecondary: '#a3a3a3',
  textMuted: '#8a8a8a',
  textFaint: '#525252',
  error: '#f87171',
} as const

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
})

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const
