import { useState, useEffect, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { useDebounce } from '@/lib/useDebounce'
import { apiFetch } from '@/lib/api'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342'

interface MovieSummary {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface PersonResult {
  person_id: number
  person_name: string
}

interface Hop {
  movie: MovieSummary
  person_name: string
}

interface TodayResponse {
  puzzle_id: number
  start_movie: MovieSummary
  end_movie: MovieSummary
  user_attempt: { is_solved: boolean; degree_count: number | null; solve_time_ms: number | null } | null
}

export default function SixDegreesScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [puzzle, setPuzzle] = useState<TodayResponse | null>(null)

  const [currentMovie, setCurrentMovie] = useState<MovieSummary | null>(null)
  const [visitedIds, setVisitedIds] = useState<number[]>([])
  const [chain, setChain] = useState<Hop[]>([])
  const [guessPath, setGuessPath] = useState<{ movie_id: number; person_id: number; next_movie_id: number }[]>([])
  const startTimeRef = useRef<number>(0)

  const [actorQuery, setActorQuery] = useState('')
  const [actorResults, setActorResults] = useState<PersonResult[]>([])
  const [selectedActor, setSelectedActor] = useState<PersonResult | null>(null)
  const [actorError, setActorError] = useState<string | null>(null)
  const [movieQuery, setMovieQuery] = useState('')
  const [movieResults, setMovieResults] = useState<MovieSummary[]>([])
  const [movieError, setMovieError] = useState<string | null>(null)

  const [solved, setSolved] = useState<{ degree_count: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const debouncedActorQuery = useDebounce(actorQuery, 300)
  const debouncedMovieQuery = useDebounce(movieQuery, 300)

  useEffect(() => {
    apiFetch('/api/games/six-degrees/today')
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return }
        const data: TodayResponse = await r.json()
        setPuzzle(data)
        if (!data.user_attempt?.is_solved) {
          setCurrentMovie(data.start_movie)
          setVisitedIds([data.start_movie.id])
          startTimeRef.current = Date.now()
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [])

  // Clear immediately on any state that invalidates in-flight/stale results —
  // debouncedActorQuery lags the visible input by up to 300ms, so relying on
  // it alone to gate "is there a query" briefly re-uses stale text against a
  // newly-current movie (e.g. searching the old actor's name against the new movie's cast).
  useEffect(() => {
    setActorResults([])
    setActorError(null)
  }, [currentMovie?.id, selectedActor, actorQuery])

  useEffect(() => {
    // Guard on both the raw and debounced query: the debounced value lags
    // the visible input by up to 300ms, so right after currentMovie changes
    // (actorQuery already reset to '') the debounced value can still be a
    // leftover non-empty string — without the raw check this fires a real,
    // non-cancelled fetch that re-populates results for a query no longer shown.
    if (selectedActor || actorQuery.trim().length < 2 || debouncedActorQuery.trim().length < 2) return
    let cancelled = false
    apiFetch(`/api/games/six-degrees/search-people?q=${encodeURIComponent(debouncedActorQuery)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setActorResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setActorResults([]) })
    return () => { cancelled = true }
  }, [debouncedActorQuery, selectedActor, actorQuery])

  useEffect(() => {
    setMovieResults([])
    setMovieError(null)
  }, [selectedActor, movieQuery])

  useEffect(() => {
    if (!selectedActor || movieQuery.trim().length < 2 || debouncedMovieQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedIds.join(',')
    apiFetch(`/api/games/six-degrees/search-movies?q=${encodeURIComponent(debouncedMovieQuery)}&exclude=${exclude}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setMovieResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setMovieResults([]) })
    return () => { cancelled = true }
  }, [debouncedMovieQuery, selectedActor, visitedIds, movieQuery])

  async function selectActor(a: PersonResult) {
    if (!currentMovie || verifying) return
    setVerifying(true)
    try {
      const res = await apiFetch(`/api/games/six-degrees/verify-actor?movie_id=${currentMovie.id}&person_id=${a.person_id}`)
      const data = await res.json()
      if (data.valid) {
        setSelectedActor(a)
      } else {
        setActorError(`${a.person_name} wasn't in this movie — try again`)
      }
    } finally {
      setVerifying(false)
    }
  }

  async function pickMovie(next: MovieSummary) {
    if (!currentMovie || !selectedActor || !puzzle || verifying) return
    setVerifying(true)
    let valid = false
    try {
      const res = await apiFetch(
        `/api/games/six-degrees/verify-connection?movie_id=${currentMovie.id}&person_id=${selectedActor.person_id}&next_movie_id=${next.id}`
      )
      valid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!valid) {
      setMovieError(`${selectedActor.person_name} wasn't in ${next.title} — try again`)
      return
    }

    const hop = { movie_id: currentMovie.id, person_id: selectedActor.person_id, next_movie_id: next.id }
    const newGuessPath = [...guessPath, hop]
    const newChain = [...chain, { movie: next, person_name: selectedActor.person_name }]
    setGuessPath(newGuessPath)
    setChain(newChain)
    setVisitedIds(prev => [...prev, next.id])
    setCurrentMovie(next)
    setSelectedActor(null)
    setActorQuery('')
    setMovieQuery('')
    setActorResults([])
    setMovieResults([])

    if (next.id === puzzle.end_movie.id) {
      setSubmitting(true)
      try {
        const res = await apiFetch('/api/games/six-degrees/attempt', {
          method: 'POST',
          body: JSON.stringify({
            puzzle_id: puzzle.puzzle_id,
            guess_path: newGuessPath,
            solve_time_ms: Date.now() - startTimeRef.current,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setSolved({ degree_count: data.degree_count })
        }
      } finally {
        setSubmitting(false)
      }
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.textMuted} />
      </SafeAreaView>
    )
  }

  if (notFound || !puzzle) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <Text style={s.empty}>No puzzle today — check back soon.</Text>
      </SafeAreaView>
    )
  }

  const alreadySolved = puzzle.user_attempt?.is_solved
  const degreeCount = solved?.degree_count ?? puzzle.user_attempt?.degree_count

  if (alreadySolved || solved) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <View style={s.center}>
          <Text style={s.heading}>Solved!</Text>
          <Text style={s.sub}>
            {puzzle.start_movie.title} → {puzzle.end_movie.title} in {degreeCount} degree{degreeCount === 1 ? '' : 's'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.posterRow}>
          <MoviePoster movie={puzzle.start_movie} />
          <Text style={s.arrow}>→</Text>
          <MoviePoster movie={puzzle.end_movie} />
        </View>

        {chain.length > 0 && (
          <View style={s.chainWrap}>
            <Text style={s.sectionLabel}>Your chain</Text>
            <Text style={s.chainText}>
              {puzzle.start_movie.title}{chain.map(h => `  →  ${h.person_name}  →  ${h.movie.title}`).join('')}
            </Text>
          </View>
        )}

        <Text style={s.currentLabel}>Currently at: {currentMovie?.title}</Text>

        {!selectedActor ? (
          <View style={s.inputWrap}>
            <Text style={s.stepLabel}>Name an actor in this movie</Text>
            <TextInput
              style={s.input}
              placeholder="Actor name"
              placeholderTextColor={Colors.textFaint}
              value={actorQuery}
              onChangeText={setActorQuery}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {actorError && <Text style={s.errorText}>{actorError}</Text>}
            {actorResults.map(a => (
              <TouchableOpacity key={a.person_id} style={s.resultRow} onPress={() => selectActor(a)} disabled={verifying}>
                <Text style={s.resultText}>{a.person_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={s.inputWrap}>
            <View style={s.selectedActorRow}>
              <Text style={s.stepLabel}>{selectedActor.person_name} was also in...</Text>
              <TouchableOpacity onPress={() => { setSelectedActor(null); setMovieQuery(''); setMovieResults([]) }}>
                <Text style={s.changeLink}>change</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.input}
              placeholder="Movie title"
              placeholderTextColor={Colors.textFaint}
              value={movieQuery}
              onChangeText={setMovieQuery}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {movieError && <Text style={s.errorText}>{movieError}</Text>}
            {movieResults.map(m => (
              <TouchableOpacity key={m.id} style={s.resultRow} onPress={() => pickMovie(m)} disabled={submitting || verifying}>
                <Text style={s.resultText}>{m.title}{m.year ? ` (${m.year})` : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {(submitting || verifying) && <ActivityIndicator style={{ marginTop: Spacing.md }} color={Colors.textMuted} />}
      </ScrollView>
    </SafeAreaView>
  )
}

function BackBar({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
      <ChevronLeft size={22} color={Colors.textSecondary} />
      <Text style={s.backText}>Games</Text>
    </TouchableOpacity>
  )
}

function MoviePoster({ movie }: { movie: MovieSummary }) {
  return (
    <View style={s.posterCard}>
      {movie.poster_path ? (
        <Image source={{ uri: `${TMDB_IMG}${movie.poster_path}` }} style={s.poster} />
      ) : (
        <View style={[s.poster, s.posterFallback]} />
      )}
      <Text style={s.posterTitle} numberOfLines={2}>{movie.title}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: 100, gap: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  heading: { fontSize: 22, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  empty: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  posterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  posterCard: { alignItems: 'center', width: 120, gap: 6 },
  poster: { width: 100, height: 150, borderRadius: 10, backgroundColor: Colors.card },
  posterFallback: { borderWidth: 1, borderColor: Colors.border },
  posterTitle: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
  arrow: { fontSize: 20, color: Colors.textFaint },
  chainWrap: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: Spacing.sm, gap: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: Colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.8 },
  chainText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  currentLabel: { fontSize: 15, fontWeight: '500', color: Colors.text },
  inputWrap: { gap: Spacing.xs },
  stepLabel: { fontSize: 13, color: Colors.textMuted },
  selectedActorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  changeLink: { fontSize: 13, color: Colors.brand },
  errorText: { fontSize: 13, color: Colors.error },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text,
  },
  resultRow: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  resultText: { fontSize: 14, color: Colors.text },
})
