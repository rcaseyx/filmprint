import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Animated, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { setPendingProfile } from '@/lib/pendingNavigation'

// Module-level guard: prevents two simultaneously-mounted ProfileBuilding instances
// (picks tab + profile tab) from both showing the alert.
let _alertShown = false

interface TopUser {
  user_id: number
  username: string | null
  display_name: string | null
  fp_score: number
}

interface Props {
  onComplete: () => void
  onError: () => void
  currentUsername?: string | null
}

export function ProfileBuilding({ onComplete, onError, currentUsername }: Props) {
  const router = useRouter()
  const dot1 = useRef(new Animated.Value(0.3)).current
  const dot2 = useRef(new Animated.Value(0.3)).current
  const dot3 = useRef(new Animated.Value(0.3)).current
  const [topUsers, setTopUsers] = useState<TopUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  // Prevents this instance from calling onComplete/Alert more than once,
  // even if the effect restarts due to prop reference changes.
  const completedRef = useRef(false)

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      )
    const a1 = pulse(dot1, 0)
    const a2 = pulse(dot2, 200)
    const a3 = pulse(dot3, 400)
    a1.start(); a2.start(); a3.start()
    return () => { a1.stop(); a2.stop(); a3.stop() }
  }, [dot1, dot2, dot3])

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch('/api/rebuild/status')
        const data = await res.json()
        if (data.status === 'done') {
          clearInterval(interval)
          if (!completedRef.current) {
            completedRef.current = true
            onComplete()
          }
          if (!_alertShown) {
            _alertShown = true
            Alert.alert(
              'Profile ready',
              'Your taste profile has been built.',
              [{
                text: 'View Picks',
                onPress: () => {
                  _alertShown = false
                  router.navigate('/(app)/picks' as any)
                },
              }],
            )
          }
        } else if (data.status === 'error') {
          clearInterval(interval)
          if (!completedRef.current) {
            completedRef.current = true
            onError()
          }
          Alert.alert('Something went wrong', "We couldn't build your profile. Try importing again.")
        }
      } catch {
        // transient — keep polling
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [onComplete, onError])

  useEffect(() => {
    apiFetch('/api/users/top?limit=6')
      .then(r => r.json())
      .then(data => {
        // Only usernamed profiles are viewable from here — pendingNavigation
        // routes by username, so a user without one has nowhere to link to.
        const filtered = (data.users ?? []).filter((u: TopUser) => u.username && u.username !== currentUsername)
        setTopUsers(filtered.slice(0, 3))
      })
      .catch(() => {})
      .finally(() => setUsersLoading(false))
  }, [currentUsername])

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.loader}>
        <ActivityIndicator size="large" color={Colors.brand} />
        <Text style={s.heading}>Building your taste profile</Text>
        <View style={s.dots}>
          <Animated.View style={[s.dot, { opacity: dot1 }]} />
          <Animated.View style={[s.dot, { opacity: dot2 }]} />
          <Animated.View style={[s.dot, { opacity: dot3 }]} />
        </View>
        <Text style={s.sub}>This takes a minute — browse while you wait.</Text>
      </View>

      <View style={s.explore}>
        <Text style={s.exploreLabel}>Explore other profiles</Text>
        {usersLoading ? (
          [0, 1, 2].map(i => <View key={i} style={s.skeleton} />)
        ) : topUsers.map(u => (
          <TouchableOpacity
            key={u.username!}
            style={s.profileCard}
            activeOpacity={0.7}
            onPress={() => {
              setPendingProfile(u.username!)
              router.navigate('/(app)/search' as any)
            }}
          >
            <Text style={s.profileName}>{u.username}</Text>
            <Text style={s.profileCount}>{u.fp_score} score</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    padding: Spacing.xl,
    paddingBottom: 100,
    gap: Spacing.xl,
  },
  loader: {
    alignItems: 'center',
    paddingTop: Spacing.xl,
    gap: Spacing.md,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand,
  },
  sub: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 260,
  },
  explore: {
    gap: Spacing.sm,
  },
  exploreLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textFaint,
  },
  skeleton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  profileName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  profileCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
})
