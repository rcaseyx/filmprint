import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'
import { FilmprintText } from '@/components/FilmprintText'
import { PrintLogo } from '@/components/PrintLogo'

export default function OnboardingEntry() {
  const router = useRouter()

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.header}>
          <PrintLogo size={80} />
          <FilmprintText width={160} />
          <Text style={s.heading}>Build your taste profile</Text>
          <Text style={s.body}>
            We need a few ratings to learn what you love. Rate some films or connect your Letterboxd account.
          </Text>
        </View>

        <View style={s.choices}>
          <TouchableOpacity style={s.primary} onPress={() => router.push('/onboarding/rate')} activeOpacity={0.85}>
            <Text style={s.primaryLabel}>Rate films</Text>
            <Text style={s.primaryHint}>Quick — just 5 to get started</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondary} onPress={() => router.push('/onboarding/letterboxd')} activeOpacity={0.85}>
            <Text style={s.secondaryLabel}>Connect Letterboxd</Text>
            <Text style={s.secondaryHint}>Import your existing ratings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.xl },
  header: { alignItems: 'center', gap: Spacing.sm },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.text, textAlign: 'center', marginTop: Spacing.xs },
  body: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  choices: { gap: Spacing.sm },
  primary: {
    backgroundColor: Colors.brand,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: 4,
  },
  primaryLabel: { fontSize: 16, fontWeight: '700', color: Colors.background },
  primaryHint: { fontSize: 12, color: Colors.background, opacity: 0.7 },
  secondary: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 18,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: 4,
  },
  secondaryLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  secondaryHint: { fontSize: 12, color: Colors.textMuted },
})
