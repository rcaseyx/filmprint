import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Colors } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function PicksScreen() {
  const router = useRouter()
  const { logout } = useAuth()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    apiFetch('/api/user')
      .then(async r => {
        if (r.status === 401) {
          await logout()
          router.replace('/login')
          return
        }
        const data = await r.json()
        if (!data.has_profile) router.replace('/onboarding')
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color={Colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <Text style={s.title}>What are you in the mood for?</Text>
        <Text style={s.subtitle}>Picks coming in Phase 3</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
})
