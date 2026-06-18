import { View, Text, StyleSheet } from 'react-native'
import { Colors } from '@/constants/theme'

export function InsightCard({
  label, value, sub, brandValue, style,
}: {
  label: string; value: string; sub: string; brandValue?: boolean; style?: object
}) {
  return (
    <View style={[s.card, style]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, brandValue && { color: Colors.brand }]}>{value}</Text>
      <Text style={s.sub}>{sub}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 3,
  },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  value: { fontSize: 20, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textMuted },
})
