import { useState, useEffect } from 'react'
import { View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, Dimensions, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useDebounce } from '@/lib/useDebounce'

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w342'
const TAB_BAR_CLEARANCE = 56

const SCREEN_W = Dimensions.get('window').width
const GRID_COLS = 3
const GRID_PADDING = Spacing.md
const GRID_GAP = 6
const POSTER_W = Math.floor((SCREEN_W - GRID_PADDING * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS)
const POSTER_H = Math.floor(POSTER_W * 1.5)

interface Round {
  posters: (string | null)[]
}

interface ActorResult {
  person_id: number
  person_name: string
  profile_path: string | null
}

interface RevealResult {
  person_name: string
  movies: { id: number; title: string }[]
  gaveUp: boolean
}

export default function CommonThreadScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [wrongGuess, setWrongGuess] = useState<string | null>(null)
  const [guessing, setGuessing] = useState(false)
  const [result, setResult] = useState<RevealResult | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ActorResult[]>([])
  const debouncedQuery = useDebounce(query, 300)

  async function loadRound() {
    setLoading(true)
    setError(false)
    setRound(null)
    setWrongGuess(null)
    setResult(null)
    setQuery('')
    setResults([])
    try {
      const res = await apiFetch('/api/games/common-thread/round')
      if (!res.ok) { setError(true); return }
      setRound(await res.json())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRound() }, [])

  useEffect(() => {
    setWrongGuess(null)
    if (query.trim().length < 2) setResults([])
  }, [query])

  useEffect(() => {
    if (result || query.trim().length < 2 || debouncedQuery.trim().length < 2) return
    let cancelled = false
    apiFetch(`/api/games/common-thread/search-actors?q=${encodeURIComponent(debouncedQuery)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
    return () => { cancelled = true }
  }, [debouncedQuery, result, query])

  async function submitGuess(actor: ActorResult) {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await apiFetch('/api/games/common-thread/guess', {
        method: 'POST',
        body: JSON.stringify({ person_id: actor.person_id }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.correct) {
        setResult({ person_name: data.person_name, movies: data.movies, gaveUp: false })
      } else {
        setWrongGuess(`Not ${actor.person_name} — keep looking`)
        setQuery('')
        setResults([])
      }
    } finally {
      setGuessing(false)
    }
  }

  async function giveUp() {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await apiFetch('/api/games/common-thread/reveal')
      if (!res.ok) return
      const data = await res.json()
      setResult({ person_name: data.person_name, movies: data.movies, gaveUp: true })
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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} onRefresh={loadRound} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.heading}>Common Thread</Text>
          <Text style={s.sub}>One actor connects these 3 movies. Name them.</Text>
        </View>

        <View style={s.grid}>
          {round.posters.map((poster, i) => (
            <View key={i} style={s.poster}>
              {poster ? (
                <Image source={{ uri: `${TMDB_POSTER}${poster}` }} style={s.posterImg} />
              ) : (
                <View style={[s.posterImg, s.posterFallback]} />
              )}
            </View>
          ))}
        </View>

        {!result && (
          <View style={s.inputWrap}>
            <Text style={s.stepLabel}>Which actor is in all 3?</Text>
            <TextInput
              style={s.input}
              placeholder="Actor name"
              placeholderTextColor={Colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!guessing}
            />
            {wrongGuess && <Text style={s.errorText}>{wrongGuess}</Text>}
            <View>
              {results.map(a => (
                <Pressable
                  key={a.person_id}
                  onPress={() => submitGuess(a)}
                  disabled={guessing}
                  style={({ pressed }) => [s.resultRow, pressed && s.resultRowPressed]}
                >
                  <Text style={s.resultText}>{a.person_name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={giveUp} disabled={guessing} hitSlop={8}>
              <Text style={s.giveUpText}>Give up &amp; reveal</Text>
            </Pressable>
          </View>
        )}

        {result && (
          <View style={s.resultWrap}>
            <Text style={s.resultLabel}>{result.gaveUp ? 'It was:' : 'Got it!'}</Text>
            <Text style={s.resultTitle}>{result.person_name}</Text>
            <Text style={s.resultMovies}>{result.movies.map(m => m.title).join(' • ')}</Text>
            <Pressable style={s.playAgainBtn} onPress={loadRound}>
              <Text style={s.playAgainText}>Play again</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
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
  grid: {
    flexDirection: 'row', gap: GRID_GAP, justifyContent: 'center',
    paddingHorizontal: GRID_PADDING, paddingTop: Spacing.lg,
  },
  poster: { width: POSTER_W, borderRadius: 8, overflow: 'hidden' },
  posterImg: { width: POSTER_W, height: POSTER_H, backgroundColor: Colors.card },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  inputWrap: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  stepLabel: { fontSize: 13, color: Colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.card,
  },
  errorText: { fontSize: 13, color: '#f87171', marginTop: 6 },
  resultRow: { paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10 },
  resultRowPressed: { backgroundColor: Colors.card },
  resultText: { fontSize: 15, color: Colors.text },
  giveUpText: { fontSize: 13, color: Colors.textMuted, marginTop: 12 },
  resultWrap: { alignItems: 'center', marginTop: Spacing.xl, paddingHorizontal: Spacing.lg },
  resultLabel: { fontSize: 17, fontWeight: '600', color: Colors.text },
  resultTitle: { fontSize: 24, fontWeight: '800', color: Colors.brand, marginTop: 4, textAlign: 'center' },
  resultMovies: { fontSize: 13, color: Colors.textMuted, marginTop: 8, textAlign: 'center' },
  playAgainBtn: {
    marginTop: Spacing.xl, width: '100%', backgroundColor: Colors.brand, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  playAgainText: { fontSize: 15, fontWeight: '700', color: Colors.background },
})
