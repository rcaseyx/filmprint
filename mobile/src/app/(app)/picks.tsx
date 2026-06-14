import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Colors } from '@/constants/theme'

export default function PicksScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.title}>What are you in the mood for?</Text>
        <Text style={s.subtitle}>Picks coming in Phase 3</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
})
