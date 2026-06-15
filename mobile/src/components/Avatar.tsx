import { View, Text, StyleSheet } from 'react-native'

const COLORS = [
  '#d97706', '#059669', '#2563eb', '#7c3aed',
  '#db2777', '#dc2626', '#0891b2', '#65a30d',
]

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const safe = name || '?'
  const initials = safe.slice(0, 2).toUpperCase()
  const bg = hashColor(safe)
  return (
    <View style={[s.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[s.text, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text: { fontWeight: '600', color: '#fff' },
})
