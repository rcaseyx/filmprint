import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, Animated,
  ActivityIndicator, ScrollView, Keyboard, PanResponder, StyleSheet,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useDebounce } from '@/lib/useDebounce'
import { useKeyboardLift } from '@/lib/useKeyboardLift'

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w780'
const TAB_BAR_CLEARANCE = 56

interface Round {
  poster_path: string | null
  crop_x: number
  crop_y: number
  stages: number[]
}

interface MovieResult {
  id: number
  title: string
  year: number | null
}

export default function FocusPullScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const restBottomPadding = insets.bottom + TAB_BAR_CLEARANCE
  const keyboardLift = useKeyboardLift(restBottomPadding)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: () => Keyboard.dismiss(),
    })
  ).current

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [stageIndex, setStageIndex] = useState(0)
  const [wrongGuess, setWrongGuess] = useState<string | null>(null)
  const [guessing, setGuessing] = useState(false)
  const [result, setResult] = useState<{ title: string; gaveUp: boolean } | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieResult[]>([])
  const debouncedQuery = useDebounce(query, 300)

  // Mobile has no clip-path equivalent, so the reveal is a center-anchored
  // zoom-out instead of web's arbitrary-focal-point iris reveal -- same game
  // feel (less visible -> more visible per wrong guess), simpler transform math
  // (RN always scales from center, no transform-origin support).
  const scale = useRef(new Animated.Value(1)).current

  async function loadRound() {
    setLoading(true)
    setError(false)
    setRound(null)
    setStageIndex(0)
    setWrongGuess(null)
    setResult(null)
    setQuery('')
    setResults([])
    try {
      const res = await apiFetch('/api/games/focus-pull/round')
      if (!res.ok) { setError(true); return }
      const data: Round = await res.json()
      setRound(data)
      scale.setValue(100 / data.stages[0])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRound() }, [])

  // Only clears results here, NOT wrongGuess -- a wrong guess clears the
  // query programmatically (to reset the field once the panel reopens), and
  // that would immediately wipe the message right back out if this effect
  // cleared it on every query change too. wrongGuess is cleared explicitly
  // in the TextInput's onChangeText instead, which only fires on real typing.
  useEffect(() => {
    if (query.trim().length < 2) setResults([])
  }, [query])

  useEffect(() => {
    if (result || query.trim().length < 2 || debouncedQuery.trim().length < 2) return
    let cancelled = false
    apiFetch(`/api/games/focus-pull/search-movies?q=${encodeURIComponent(debouncedQuery)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
    return () => { cancelled = true }
  }, [debouncedQuery, result, query])

  function animateToStage(index: number) {
    if (!round) return
    setStageIndex(index)
    Animated.timing(scale, {
      toValue: 100 / round.stages[index],
      duration: 700,
      useNativeDriver: true,
    }).start()
  }

  async function submitGuess(movie: MovieResult) {
    if (guessing || result || !round) return
    setGuessing(true)
    setWrongGuess(null)
    try {
      const res = await apiFetch('/api/games/focus-pull/guess', {
        method: 'POST',
        body: JSON.stringify({ movie_id: movie.id }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.correct) {
        Keyboard.dismiss()
        animateToStage(round.stages.length - 1)
        setResult({ title: data.title, gaveUp: false })
      } else {
        Keyboard.dismiss()
        setWrongGuess(`Not ${movie.title} — take another look`)
        setQuery('')
        setResults([])
        animateToStage(Math.min(stageIndex + 1, round.stages.length - 1))
      }
    } finally {
      setGuessing(false)
    }
  }

  async function giveUp() {
    if (guessing || result || !round) return
    setGuessing(true)
    try {
      const res = await apiFetch('/api/games/focus-pull/reveal')
      if (!res.ok) return
      const data = await res.json()
      Keyboard.dismiss()
      animateToStage(round.stages.length - 1)
      setResult({ title: data.title, gaveUp: true })
    } finally {
      setGuessing(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} onRefresh={() => {}} />
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.textMuted} />
      </SafeAreaView>
    )
  }

  if (error || !round) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} onRefresh={loadRound} />
        <Text style={s.empty}>Couldn&rsquo;t load a round — try refreshing.</Text>
      </SafeAreaView>
    )
  }

  const atFinalStage = stageIndex >= round.stages.length - 1

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} onRefresh={loadRound} />

      {/* Poster: scrolls independently above the fixed input area below, so
          it never competes for scroll position with it. Stays visible (and
          the reveal renders right underneath it) instead of swapping to a
          separate screen once solved. */}
      <ScrollView style={s.contentFlex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.heading}>Focus Pull</Text>
          <Text style={s.sub}>Name the movie before the whole poster comes into focus.</Text>
        </View>
        <View style={s.posterFrame}>
          {round.poster_path ? (
            <Animated.Image
              source={{ uri: `${TMDB_POSTER}${round.poster_path}` }}
              style={[s.posterImg, { transform: [{ scale }] }]}
            />
          ) : (
            <Text style={s.empty}>No poster</Text>
          )}
        </View>
        {result && (
          <View style={s.resultCard}>
            <Text style={s.resultLabel}>{result.gaveUp ? 'It was:' : 'Got it!'}</Text>
            <Text style={s.resultTitle}>{result.title}</Text>
          </View>
        )}
      </ScrollView>

      {/* Input area: floats over the content (position: absolute), not a flex
          sibling competing with it for space -- same fixed-panel pattern as
          Co-Star (six-degrees.tsx), including a nested ScrollView so a long
          results list scrolls within its own bounded area instead of trying
          (and failing) to grow the panel indefinitely. A wrong guess dismisses
          the keyboard and clears the results list, so the panel drops back
          to its small resting size (just the input box) instead of staying
          tall and covering the poster. Once solved, this becomes a single
          "Play again" bar in the same slot. */}
      <Animated.View
        style={[
          s.inputArea,
          { paddingBottom: restBottomPadding, transform: [{ translateY: keyboardLift }] },
        ]}
      >
        {result ? (
          <Pressable style={s.playAgainBtn} onPress={loadRound}>
            <Text style={s.playAgainText}>Play again</Text>
          </Pressable>
        ) : (
          <>
            <View {...panResponder.panHandlers} style={s.handleWrap} hitSlop={8}>
              <View style={s.handleBar} />
            </View>

            <Text style={s.stepLabel}>What movie is this?</Text>
            <TextInput
              style={s.input}
              placeholder="Movie title"
              placeholderTextColor={Colors.textFaint}
              value={query}
              onChangeText={(text) => { setQuery(text); setWrongGuess(null) }}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!guessing}
            />
            {wrongGuess && <Text style={s.errorText}>{wrongGuess}</Text>}
            <ScrollView style={s.resultsScroll} keyboardShouldPersistTaps="handled">
              {results.map(m => (
                <Pressable
                  key={m.id}
                  onPress={() => submitGuess(m)}
                  disabled={guessing}
                  style={({ pressed }) => [s.resultRow, pressed && s.resultRowPressed]}
                >
                  <Text style={s.resultText}>{m.title}{m.year ? ` (${m.year})` : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {atFinalStage && (
              <Pressable onPress={giveUp} disabled={guessing} hitSlop={8}>
                <Text style={s.giveUpText}>Give up &amp; reveal</Text>
              </Pressable>
            )}
          </>
        )}
      </Animated.View>
    </SafeAreaView>
  )
}

function BackBar({ router, onRefresh }: { router: ReturnType<typeof useRouter>; onRefresh: () => void }) {
  return (
    <View style={s.backBar}>
      <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>Games</Text>
      </Pressable>
      <Pressable style={s.refreshBtn} onPress={onRefresh} hitSlop={10}>
        <RefreshCw size={18} color={Colors.textMuted} />
        <Text style={s.refreshText}>New round</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: Spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm },
  refreshText: { fontSize: 13, color: Colors.textMuted },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: 3 },
  heading: { fontSize: 20, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  empty: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  contentFlex: { flex: 1 },
  // Bottom padding here reserves room for the floating input panel's typical
  // resting height, matching the historyScroll pattern in six-degrees.tsx.
  content: { paddingBottom: 320 },
  posterFrame: {
    width: 240, aspectRatio: 2 / 3, alignSelf: 'center', marginTop: Spacing.lg,
    borderRadius: 14, overflow: 'hidden', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  posterImg: { width: '100%', height: '100%' },
  inputArea: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.sm,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handleBar: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border },
  stepLabel: { fontSize: 13, color: Colors.textMuted },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.card,
  },
  errorText: { fontSize: 13, color: Colors.error },
  resultsScroll: { maxHeight: 220 },
  resultRow: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  resultRowPressed: { backgroundColor: Colors.card },
  resultText: { fontSize: 14, color: Colors.text },
  giveUpText: { fontSize: 13, color: Colors.textMuted, paddingVertical: 6 },
  resultCard: { alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  resultLabel: { fontSize: 17, fontWeight: '600', color: Colors.text },
  resultTitle: { fontSize: 24, fontWeight: '800', color: Colors.brand, marginTop: 4, textAlign: 'center' },
  playAgainBtn: {
    width: '100%', backgroundColor: Colors.brand, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginVertical: Spacing.sm,
  },
  playAgainText: { fontSize: 15, fontWeight: '700', color: Colors.background },
})
