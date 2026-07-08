import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'

export default function GamesScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.heading}>Games</Text>
        <Text style={s.sub}>Daily movie challenges</Text>
      </View>

      <TouchableOpacity
        style={s.card}
        activeOpacity={0.7}
        onPress={() => router.push('/games/six-degrees' as any)}
      >
        <Text style={s.cardTitle}>Six Degrees</Text>
        <Text style={s.cardDesc}>Connect today's two movies through shared cast, one hop at a time.</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.sm, gap: 3 },
  heading: { fontSize: 24, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: Colors.textMuted },
  card: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: Spacing.md, gap: 4,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: Colors.text },
  cardDesc: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
})
