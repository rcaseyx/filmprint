import { useEffect, useState, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'
const MIN_RATINGS = 5
const { width } = Dimensions.get('window')
const CARD_WIDTH = width - Spacing.lg * 2

type Film = { id: number; title: string; year: number | null; poster_path: string | null }

export default function RateScreen() {
  const router = useRouter()
  const [films, setFilms] = useState<Film[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [index, setIndex] = useState(0)
  const [ratings, setRatings] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitLabel, setSubmitLabel] = useState('')
  const [submitError, setSubmitError] = useState('')

  const slideAnim = useRef(new Animated.Value(0)).current
  const nudgeAnim = useRef(new Animated.Value(0)).current
  // useNativeDriver:false required for width — runs on JS thread but fine for a progress bar
  const progressAnim = useRef(new Animated.Value(0)).current
  // One opacity value per star — 0 = empty (☆), 1 = filled (★)
  const starAnims = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current

  const resetStars = () => {
    starAnims.forEach(a => { a.stopAnimation(); a.setValue(0) })
  }

  useEffect(() => {
    apiFetch('/api/onboarding/seed-films')
      .then(r => r.json())
      .then(setFilms)
      .catch(() => setFetchError('Could not load films'))
      .finally(() => setLoading(false))
  }, [])

  const ratedCount = Object.keys(ratings).length
  const current = films[index]
  const allSeen = index >= films.length

  const advance = (action: () => void, afterSlideIn?: () => void) => {
    Animated.timing(slideAnim, {
      toValue: -width,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      action()
      slideAnim.setValue(width)
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => afterSlideIn?.())
    })
  }

  const rate = (stars: number) => {
    if (!current) return
    const nextCount = ratedCount + 1

    Animated.timing(progressAnim, {
      toValue: Math.min(nextCount / MIN_RATINGS, 1),
      duration: 300,
      useNativeDriver: false,
    }).start()

    advance(
      () => {
        setRatings(prev => ({ ...prev, [current.id]: stars }))
        setIndex(idx => idx + 1)
        if (nextCount === MIN_RATINGS) {
          Animated.spring(nudgeAnim, {
            toValue: 1,
            useNativeDriver: true,
            tension: 60,
            friction: 10,
          }).start()
        }
      },
      () => {
        // New poster has landed — quickly drain stars right-to-left
        Animated.stagger(
          35,
          starAnims.slice(0, stars).reverse().map(anim =>
            Animated.timing(anim, { toValue: 0, duration: 70, useNativeDriver: true })
          )
        ).start()
      }
    )
  }

  const skip = () => {
    resetStars() // no drain animation for skip, clear immediately
    advance(() => setIndex(i => i + 1))
  }

  const submit = async () => {
    setSubmitting(true)
    setSubmitError('')
    setSubmitLabel('Saving your ratings…')
    try {
      const res = await apiFetch('/api/onboarding/rate', {
        method: 'POST',
        body: JSON.stringify({
          ratings: Object.entries(ratings).map(([movie_id, rating]) => ({
            movie_id: Number(movie_id),
            rating,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? 'Something went wrong')
      }
      setSubmitLabel('Building your taste profile…')
      router.replace('/picks')
    } catch (e: any) {
      setSubmitError(e.message)
      setSubmitting(false)
      setSubmitLabel('')
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator color={Colors.brand} /></View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><Text style={s.errorText}>{fetchError}</Text></View>
      </SafeAreaView>
    )
  }

  if (submitting) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.brand} />
          <Text style={s.submitLabel}>{submitLabel}</Text>
          <Text style={s.submitHint}>This may take a moment</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        <View style={s.topBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.counter}>{ratedCount} / {MIN_RATINGS} rated</Text>
        </View>

        <View style={s.progressTrack}>
          <Animated.View style={[s.progressFill, {
            width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]} />
        </View>

        {/* Only the poster animates */}
        <View style={s.posterArea}>
          {allSeen ? (
            <View style={s.posterFallback}>
              <Text style={s.seenAll}>You've seen all our suggestions!</Text>
            </View>
          ) : (
            <Animated.View style={{ transform: [{ translateX: slideAnim }], flex: 1 }}>
              {current.poster_path ? (
                <Image
                  source={{ uri: `${TMDB_IMG}${current.poster_path}` }}
                  style={s.poster}
                  contentFit="contain"
                />
              ) : (
                <View style={[s.poster, s.posterFallback]}>
                  <Text style={s.posterFallbackText}>{current.title}</Text>
                </View>
              )}
            </Animated.View>
          )}
        </View>

        {/* Title updates instantly */}
        <View style={s.filmInfo}>
          {!allSeen && (
            <>
              <Text style={s.filmTitle} numberOfLines={2}>{current.title}</Text>
              {current.year && <Text style={s.filmYear}>{current.year}</Text>}
            </>
          )}
        </View>

        {/* Stars: empty ☆ base, filled ★ fades in/out via Animated.Value */}
        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity
              key={n}
              onPressIn={() => {
                starAnims.forEach((anim, i) => {
                  anim.stopAnimation()
                  anim.setValue(i < n ? 1 : 0)
                })
              }}
              onPress={() => rate(n)}
              disabled={allSeen}
              activeOpacity={1}
              style={s.starBtn}
            >
              <View style={s.starWrap}>
                <Text style={s.star}>☆</Text>
                <Animated.View style={[s.starOverlay, { opacity: starAnims[n - 1] }]}>
                  <Text style={s.starFilled}>★</Text>
                </Animated.View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity onPress={skip} disabled={allSeen} hitSlop={8} style={s.skipBtn}>
          <Text style={s.skip}>Haven't seen it</Text>
        </TouchableOpacity>

        <View style={s.footer}>
          {!!submitError && <Text style={s.errorText}>{submitError}</Text>}
          <TouchableOpacity
            style={[s.submitBtn, ratedCount < MIN_RATINGS && s.submitDisabled]}
            onPress={submit}
            disabled={ratedCount < MIN_RATINGS}
            activeOpacity={0.85}
          >
            <Text style={[s.submitText, ratedCount < MIN_RATINGS && s.submitTextDim]}>
              {ratedCount < MIN_RATINGS
                ? `Rate ${MIN_RATINGS - ratedCount} more to continue`
                : 'Build my profile →'}
            </Text>
          </TouchableOpacity>

          {/* Fixed-height slot below button — nudge springs in without shifting layout */}
          <View style={s.nudgeSlot}>
            <Animated.View style={[s.nudge, {
              opacity: nudgeAnim,
              transform: [{ translateY: nudgeAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
            }]}>
              <Text style={s.nudgeText}>⚡ More ratings = sharper recommendations</Text>
            </Animated.View>
          </View>
        </View>

      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, padding: Spacing.lg, gap: Spacing.sm },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { fontSize: 14, color: Colors.textMuted },
  counter: { fontSize: 13, color: Colors.textSecondary },
  progressTrack: { height: 3, backgroundColor: Colors.border, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: Colors.brand, borderRadius: 2 },
  posterArea: { flex: 1, overflow: 'hidden', borderRadius: 12, marginTop: Spacing.md },
  poster: { width: CARD_WIDTH, flex: 1, borderRadius: 12 },
  posterFallback: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  posterFallbackText: { color: Colors.textMuted, textAlign: 'center', padding: Spacing.md, fontSize: 16 },
  filmInfo: { alignItems: 'center', gap: 2, minHeight: 42 },
  filmTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  filmYear: { fontSize: 13, color: Colors.textMuted },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs },
  starBtn: { padding: 6 },
  starWrap: { justifyContent: 'center', alignItems: 'center' },
  star: { fontSize: 34, color: Colors.border },
  starOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  starFilled: { fontSize: 34, color: Colors.brand },
  skipBtn: { alignItems: 'center', marginBottom: Spacing.md },
  skip: { fontSize: 13, color: Colors.textMuted },
  seenAll: { fontSize: 15, color: Colors.textMuted, textAlign: 'center' },
  nudgeSlot: { height: 40, justifyContent: 'center' },
  nudge: {
    backgroundColor: '#1a1a00',
    borderWidth: 1,
    borderColor: '#3d3000',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
  },
  nudgeText: { fontSize: 12, color: Colors.brand, fontWeight: '500' },
  footer: { gap: Spacing.sm },
  submitBtn: {
    backgroundColor: Colors.brand,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  submitTextDim: { color: Colors.textMuted, fontWeight: '500' },
  submitLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  submitHint: { fontSize: 13, color: Colors.textMuted },
  errorText: { fontSize: 12, color: Colors.error, textAlign: 'center' },
})
