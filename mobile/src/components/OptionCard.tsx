import { useRef } from 'react'
import { Text, Pressable, Animated, StyleSheet } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'

export function OptionCard({ Icon, label, sub, selected, onPress }: {
  Icon: LucideIcon; label: string; sub: string; selected: boolean; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const pressIn  = () => Animated.spring(scale, { toValue: 0.94, tension: 300, friction: 10, useNativeDriver: true }).start()
  const pressOut = () => Animated.spring(scale, { toValue: 1,    tension: 200, friction: 12, useNativeDriver: true }).start()

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={oc.pressable}>
      <Animated.View style={[oc.card, selected && oc.cardActive, { transform: [{ scale }] }]}>
        <Icon size={26} color={selected ? '#0a0a0a' : Colors.textMuted} strokeWidth={1.5} />
        <Text style={[oc.label, selected && oc.labelActive]}>{label}</Text>
        <Text style={[oc.sub, selected && oc.subActive]}>{sub}</Text>
      </Animated.View>
    </Pressable>
  )
}

const oc = StyleSheet.create({
  pressable: { flex: 1 },
  card: {
    flex: 1, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: Spacing.sm,
  },
  cardActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  label: { fontSize: 16, fontWeight: '700', color: Colors.text },
  labelActive: { color: '#0a0a0a' },
  sub: { fontSize: 12, textAlign: 'center', lineHeight: 16, color: Colors.textMuted },
  subActive: { color: '#1a1a1a' },
})
