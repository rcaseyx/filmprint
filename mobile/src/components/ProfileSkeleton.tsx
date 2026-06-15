import { useEffect, useRef } from 'react'
import { View, ScrollView, Animated, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Colors, Spacing } from '@/constants/theme'

function Bone({ w, h, style }: { w: number | string; h: number; style?: object }) {
  return <View style={[{ width: w as any, height: h, borderRadius: 6, backgroundColor: Colors.border }, style]} />
}

export function ProfileSkeleton({ bare }: { bare?: boolean } = {}) {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  const content = (
    <Animated.View style={{ flex: 1, opacity }}>
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
        >
          {/* Header */}
          <View style={{ gap: 8 }}>
            <Bone w="55%" h={24} />
            <Bone w="72%" h={13} />
          </View>

          {/* Stats — 3 cards */}
          <View style={s.row}>
            {[0, 1, 2].map(i => (
              <View key={i} style={s.statCard}>
                <Bone w={64} h={28} style={{ alignSelf: 'center' }} />
                <Bone w={48} h={10} style={{ alignSelf: 'center' }} />
              </View>
            ))}
          </View>

          {/* Radar */}
          <Bone w="100%" h={220} style={{ borderRadius: 14 }} />

          {/* Genre bars */}
          <View style={{ gap: 8 }}>
            <Bone w="38%" h={10} />
            {[90, 75, 68, 55, 48, 40, 32, 25].map((w, i) => (
              <View key={i} style={s.barRow}>
                <Bone w={110} h={10} />
                <View style={s.barTrack}>
                  <Bone w={`${w}%`} h={6} style={{ borderRadius: 99 }} />
                </View>
                <Bone w={24} h={10} />
              </View>
            ))}
          </View>

          {/* Insight cards */}
          <Bone w="100%" h={118} style={{ borderRadius: 14 }} />

          {/* Past picks */}
          <View style={{ gap: 10 }}>
            <Bone w="28%" h={10} />
            <View style={s.posterRow}>
              {[0, 1, 2, 3, 4].map(i => (
                <View key={i} style={{ width: 104, gap: 6 }}>
                  <Bone w={104} h={156} style={{ borderRadius: 8 }} />
                  <Bone w={64} h={10} />
                  <Bone w={40} h={10} />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </Animated.View>
  )

  if (bare) return content

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {content}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: 28, paddingBottom: 100 },
  row: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, gap: 8, backgroundColor: Colors.card,
    borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 99, overflow: 'hidden' },
  posterRow: { flexDirection: 'row', gap: 10 },
})
