import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

interface Props {
  onComplete: () => void
  onError: () => void
}

export function ProfileBuilding({ onComplete, onError }: Props) {
  const dot1 = useRef(new Animated.Value(0.3)).current
  const dot2 = useRef(new Animated.Value(0.3)).current
  const dot3 = useRef(new Animated.Value(0.3)).current

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
          onComplete()
        } else if (data.status === 'error') {
          clearInterval(interval)
          onError()
        }
      } catch {
        // transient — keep polling
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [onComplete, onError])

  return (
    <View style={s.wrap}>
      <ActivityIndicator size="large" color={Colors.brand} />
      <Text style={s.heading}>Building your taste profile</Text>
      <View style={s.dots}>
        <Animated.View style={[s.dot, { opacity: dot1 }]} />
        <Animated.View style={[s.dot, { opacity: dot2 }]} />
        <Animated.View style={[s.dot, { opacity: dot3 }]} />
      </View>
      <Text style={s.sub}>This takes a minute — we'll update automatically when it's ready.</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
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
})
