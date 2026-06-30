import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Colors } from '@/constants/theme'

export function InsightCard({
  label, value, sub, brandValue, style, onPress,
}: {
  label: string; value: string; sub?: string; brandValue?: boolean; style?: object; onPress?: () => void
}) {
  const children = (
    <>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, brandValue && { color: Colors.brand }]}>{value}</Text>
      {sub && <Text style={s.sub}>{sub}</Text>}
    </>
  )
  if (onPress) {
    return (
      <View style={style}>
        <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[s.card, { flex: 1 }]}>{children}</TouchableOpacity>
      </View>
    )
  }
  return <View style={[s.card, style]}>{children}</View>
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
