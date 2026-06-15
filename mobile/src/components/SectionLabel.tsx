import { Text, StyleSheet } from 'react-native'
import { Colors } from '@/constants/theme'

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.text}>{children}</Text>
}

const s = StyleSheet.create({
  text: {
    fontSize: 12, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2,
  },
})
