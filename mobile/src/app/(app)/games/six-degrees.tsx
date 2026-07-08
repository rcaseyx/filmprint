import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView,
  StyleSheet, Animated, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, ArrowRight, Trophy } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { Avatar } from '@/components/Avatar'
import { useDebounce } from '@/lib/useDebounce'
import { apiFetch } from '@/lib/api'

const TMDB_PROFILE = 'https://image.tmdb.org/t/p/w185'
const TMDB_POSTER_THUMB = 'https://image.tmdb.org/t/p/w154'
const SCREEN_W = Dimensions.get('window').width
const HEADSHOT_W = Math.floor((SCREEN_W - Spacing.lg * 2 - 56) / 2)
const HEADSHOT_H = Math.floor(HEADSHOT_W * 1.5)

interface PersonSummary {
  id: number
  name: string
  profile_path: string | null
}

interface PersonResult {
  person_id: number
  person_name: string
  profile_path: string | null
}

interface MovieSummary {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface Hop {
  movie: MovieSummary
  person: PersonResult
}

interface TodayResponse {
  puzzle_id?: number
  start_person: PersonSummary
  end_person: PersonSummary
  user_attempt?: { is_solved: boolean; degree_count: number | null; solve_time_ms: number | null } | null
}

function FadeInUp({ children, style }: { children: React.ReactNode; style?: object }) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(10)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start()
  }, [])
  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>
}

export default function SixDegreesScreen() {
  const router = useRouter()
  const { practice } = useLocalSearchParams<{ practice?: string }>()
  const isPractice = practice === '1'
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [puzzle, setPuzzle] = useState<TodayResponse | null>(null)

  const [currentPerson, setCurrentPerson] = useState<PersonResult | null>(null)
  const [visitedMovieIds, setVisitedMovieIds] = useState<number[]>([])
  const [visitedPersonIds, setVisitedPersonIds] = useState<number[]>([])
  const [chain, setChain] = useState<Hop[]>([])
  const [guessPath, setGuessPath] = useState<{ person_id: number; movie_id: number; next_person_id: number }[]>([])
  const startTimeRef = useRef<number>(0)
  const scrollRef = useRef<ScrollView>(null)

  const [movieQuery, setMovieQuery] = useState('')
  const [movieResults, setMovieResults] = useState<MovieSummary[]>([])
  const [selectedMovie, setSelectedMovie] = useState<MovieSummary | null>(null)
  const [movieError, setMovieError] = useState<string | null>(null)
  const [actorQuery, setActorQuery] = useState('')
  const [actorResults, setActorResults] = useState<PersonResult[]>([])
  const [actorError, setActorError] = useState<string | null>(null)

  const [solved, setSolved] = useState<{ degree_count: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const debouncedMovieQuery = useDebounce(movieQuery, 300)
  const debouncedActorQuery = useDebounce(actorQuery, 300)

  async function loadPuzzle() {
    setLoading(true)
    setNotFound(false)
    setSolved(null)
    setChain([])
    setGuessPath([])
    setVisitedMovieIds([])
    setVisitedPersonIds([])
    setMovieQuery(''); setMovieResults([]); setSelectedMovie(null); setMovieError(null)
    setActorQuery(''); setActorResults([]); setActorError(null)
    try {
      const r = await apiFetch(isPractice ? '/api/games/six-degrees/practice' : '/api/games/six-degrees/today')
      if (r.status === 404) { setNotFound(true); return }
      const data: TodayResponse = await r.json()
      setPuzzle(data)
      if (!data.user_attempt?.is_solved) {
        setCurrentPerson({
          person_id: data.start_person.id,
          person_name: data.start_person.name,
          profile_path: data.start_person.profile_path,
        })
        setVisitedPersonIds([data.start_person.id])
        startTimeRef.current = Date.now()
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPuzzle() }, [isPractice])

  // Clear immediately on any state that invalidates in-flight/stale results —
  // debouncedMovieQuery lags the visible input by up to 300ms, so relying on
  // it alone to gate "is there a query" briefly re-uses stale text against a
  // newly-current actor (e.g. searching the old movie title against the new actor).
  useEffect(() => {
    setMovieResults([])
    setMovieError(null)
  }, [currentPerson?.person_id, selectedMovie, movieQuery])

  useEffect(() => {
    if (!currentPerson || selectedMovie || movieQuery.trim().length < 2 || debouncedMovieQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedMovieIds.join(',')
    apiFetch(`/api/games/six-degrees/search-movies?q=${encodeURIComponent(debouncedMovieQuery)}&exclude=${exclude}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setMovieResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setMovieResults([]) })
    return () => { cancelled = true }
  }, [debouncedMovieQuery, currentPerson, selectedMovie, movieQuery, visitedMovieIds])

  useEffect(() => {
    setActorResults([])
    setActorError(null)
  }, [selectedMovie, actorQuery])

  useEffect(() => {
    if (!selectedMovie || actorQuery.trim().length < 2 || debouncedActorQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedPersonIds.join(',')
    apiFetch(`/api/games/six-degrees/search-people?q=${encodeURIComponent(debouncedActorQuery)}&exclude=${exclude}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setActorResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setActorResults([]) })
    return () => { cancelled = true }
  }, [debouncedActorQuery, selectedMovie, actorQuery, visitedPersonIds])

  // Results render below their input, so once they populate, push them up
  // above the keyboard rather than leaving them hidden underneath it.
  useEffect(() => {
    if (movieResults.length === 0) return
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [movieResults])

  useEffect(() => {
    if (actorResults.length === 0) return
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [actorResults])

  // Verifies next connects to currentPerson via movie, and if so records the hop
  // and advances (submitting the attempt if next is the target). Returns whether
  // it succeeded. silent suppresses the error message -- used for the "does this
  // movie already reach the target?" speculative check in selectMovie, where a
  // false result just means "keep going," not a real wrong guess.
  async function tryAdvance(movie: MovieSummary, next: PersonResult, silent = false): Promise<boolean> {
    if (!currentPerson || !puzzle || verifying) return false
    setVerifying(true)
    let valid = false
    try {
      const res = await apiFetch(
        `/api/games/six-degrees/verify-shared-movie?movie_id=${movie.id}&person_id=${currentPerson.person_id}&next_person_id=${next.person_id}`
      )
      valid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!valid) {
      if (!silent) setActorError(`${next.person_name} wasn't in ${movie.title} — try again`)
      return false
    }

    const hop = { person_id: currentPerson.person_id, movie_id: movie.id, next_person_id: next.person_id }
    const newGuessPath = [...guessPath, hop]
    const newChain = [...chain, { movie, person: next }]
    setGuessPath(newGuessPath)
    setChain(newChain)

    if (next.person_id === puzzle.end_person.id) {
      // Don't advance currentPerson/reset the input UI here -- that would
      // briefly render "Current actor: {target}" while the attempt is still
      // submitting. Leave the in-progress view as-is and jump straight from
      // "submitting" to the solved screen once we hear back.
      setSubmitting(true)
      try {
        const res = isPractice
          ? await apiFetch('/api/games/six-degrees/practice/attempt', {
              method: 'POST',
              body: JSON.stringify({
                start_person_id: puzzle.start_person.id,
                end_person_id: puzzle.end_person.id,
                guess_path: newGuessPath,
              }),
            })
          : await apiFetch('/api/games/six-degrees/attempt', {
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
      return true
    }

    setVisitedMovieIds(prev => [...prev, movie.id])
    setVisitedPersonIds(prev => [...prev, next.person_id])
    setCurrentPerson(next)
    setSelectedMovie(null)
    setMovieQuery('')
    setActorQuery('')
    setMovieResults([])
    setActorResults([])
    return true
  }

  async function selectMovie(m: MovieSummary) {
    if (!currentPerson || !puzzle || verifying) return
    setVerifying(true)
    let actorValid = false
    try {
      const res = await apiFetch(`/api/games/six-degrees/verify-actor?movie_id=${m.id}&person_id=${currentPerson.person_id}`)
      actorValid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!actorValid) {
      setMovieError(`${currentPerson.person_name} wasn't in ${m.title} — try again`)
      return
    }

    // If the target actor was also in this movie, finish immediately rather
    // than making the player type out the name they're already trying to reach.
    const target: PersonResult = {
      person_id: puzzle.end_person.id,
      person_name: puzzle.end_person.name,
      profile_path: puzzle.end_person.profile_path,
    }
    const reachedTarget = await tryAdvance(m, target, true)
    if (reachedTarget) return

    setSelectedMovie(m)
  }

  async function pickActor(next: PersonResult) {
    if (!selectedMovie) return
    await tryAdvance(selectedMovie, next)
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} practice={isPractice} />
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.textMuted} />
      </SafeAreaView>
    )
  }

  if (notFound || !puzzle) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} practice={isPractice} />
        <Text style={s.empty}>No puzzle today — check back soon.</Text>
      </SafeAreaView>
    )
  }

  const alreadySolved = puzzle.user_attempt?.is_solved
  const degreeCount = solved?.degree_count ?? puzzle.user_attempt?.degree_count

  if (alreadySolved || solved) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} practice={isPractice} />
        <ScrollView contentContainerStyle={s.solvedScroll} keyboardShouldPersistTaps="handled">
          <FadeInUp style={s.center}>
            <View style={s.trophyBadge}>
              <Trophy size={30} color={Colors.background} strokeWidth={2} />
            </View>
            <Text style={s.heading}>Solved!</Text>
            <Text style={s.sub}>{degreeCount} degree{degreeCount === 1 ? '' : 's'}</Text>
          </FadeInUp>
          {chain.length > 0 ? (
            <ChainTimeline startPerson={puzzle.start_person} chain={chain} />
          ) : (
            <View style={s.solvedRow}>
              <SmallHeadshot person={puzzle.start_person} />
              <ArrowRight size={18} color={Colors.textFaint} />
              <SmallHeadshot person={puzzle.end_person} />
            </View>
          )}
          {isPractice && (
            <Pressable style={s.playAgainBtn} onPress={loadPuzzle}>
              <Text style={s.playAgainText}>Play again</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
      <BackBar router={router} practice={isPractice} />
      <ScrollView
        ref={scrollRef}
        style={s.scrollFlex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.matchupRow}>
          <BigHeadshot person={puzzle.start_person} />
          <View style={s.connectorBadge}>
            <ArrowRight size={18} color={Colors.background} strokeWidth={2.5} />
          </View>
          <BigHeadshot person={puzzle.end_person} />
        </View>

        {chain.length > 0 && <ChainTimeline startPerson={puzzle.start_person} chain={chain} />}

        <View style={s.turnCard}>
          {currentPerson?.profile_path ? (
            <Image source={{ uri: `${TMDB_PROFILE}${currentPerson.profile_path}` }} style={s.turnAvatar} />
          ) : (
            <View style={s.turnAvatarFallback}>
              <Avatar name={currentPerson?.person_name ?? '?'} size={40} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.turnLabel}>Current actor</Text>
            <Text style={s.turnName}>{currentPerson?.person_name}</Text>
          </View>
        </View>

        {!selectedMovie ? (
          <View style={s.inputWrap}>
            <Text style={s.stepLabel}>Name a movie they were in</Text>
            <TextInput
              style={s.input}
              placeholder="Movie title"
              placeholderTextColor={Colors.textFaint}
              value={movieQuery}
              onChangeText={setMovieQuery}
              autoCapitalize="words"
              autoCorrect={false}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
            />
            {movieError && <Text style={s.errorText}>{movieError}</Text>}
            {movieResults.map(m => (
              <Pressable
                key={m.id}
                onPress={() => selectMovie(m)}
                disabled={verifying}
                style={({ pressed }) => [s.resultRow, pressed && s.resultRowPressed]}
              >
                {m.poster_path ? (
                  <Image source={{ uri: `${TMDB_POSTER_THUMB}${m.poster_path}` }} style={s.resultThumb} />
                ) : (
                  <View style={[s.resultThumb, s.resultThumbFallback]} />
                )}
                <Text style={s.resultText}>{m.title}{m.year ? ` (${m.year})` : ''}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={s.inputWrap}>
            <FadeInUp style={s.selectedMovieCard}>
              {selectedMovie.poster_path ? (
                <Image source={{ uri: `${TMDB_POSTER_THUMB}${selectedMovie.poster_path}` }} style={s.selectedMoviePoster} />
              ) : (
                <View style={[s.selectedMoviePoster, s.selectedMoviePosterFallback]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.turnLabel}>Selected movie</Text>
                <Text style={s.selectedMovieTitle} numberOfLines={2}>
                  {selectedMovie.title}{selectedMovie.year ? ` (${selectedMovie.year})` : ''}
                </Text>
              </View>
              <Pressable onPress={() => { setSelectedMovie(null); setActorQuery(''); setActorResults([]) }} hitSlop={8}>
                <Text style={s.changeLink}>change</Text>
              </Pressable>
            </FadeInUp>

            <Text style={s.stepLabel}>Name another actor in this movie</Text>
            <TextInput
              style={s.input}
              placeholder="Actor name"
              placeholderTextColor={Colors.textFaint}
              value={actorQuery}
              onChangeText={setActorQuery}
              autoCapitalize="words"
              autoCorrect={false}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
            />
            {actorError && <Text style={s.errorText}>{actorError}</Text>}
            {actorResults.map(a => (
              <Pressable
                key={a.person_id}
                onPress={() => pickActor(a)}
                disabled={submitting || verifying}
                style={({ pressed }) => [s.resultRow, pressed && s.resultRowPressed]}
              >
                {a.profile_path ? (
                  <Image source={{ uri: `${TMDB_PROFILE}${a.profile_path}` }} style={s.resultAvatar} />
                ) : (
                  <Avatar name={a.person_name} size={36} />
                )}
                <Text style={s.resultText}>{a.person_name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {(submitting || verifying) && <ActivityIndicator style={{ marginTop: Spacing.md }} color={Colors.textMuted} />}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function BackBar({ router, practice }: { router: ReturnType<typeof useRouter>; practice?: boolean }) {
  return (
    <View style={s.backBar}>
      <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>Games</Text>
      </Pressable>
      {practice && (
        <View style={s.practicePill}>
          <Text style={s.practicePillText}>Practice</Text>
        </View>
      )}
    </View>
  )
}

function BigHeadshot({ person }: { person: PersonSummary }) {
  return (
    <View style={s.bigHeadshotCard}>
      {person.profile_path ? (
        <Image source={{ uri: `${TMDB_PROFILE}${person.profile_path}` }} style={s.bigHeadshotImg} />
      ) : (
        <View style={[s.bigHeadshotImg, s.bigHeadshotFallback]}>
          <Avatar name={person.name} size={Math.floor(HEADSHOT_W * 0.4)} />
        </View>
      )}
      <Text style={s.bigHeadshotName} numberOfLines={2}>{person.name}</Text>
    </View>
  )
}

type ChainEntry =
  | { kind: 'person'; name: string; profile_path: string | null }
  | { kind: 'movie'; title: string; poster_path: string | null }

function buildChainEntries(startPerson: PersonSummary, chain: Hop[]): ChainEntry[] {
  const entries: ChainEntry[] = [{ kind: 'person', name: startPerson.name, profile_path: startPerson.profile_path }]
  for (const h of chain) {
    entries.push({ kind: 'movie', title: h.movie.title, poster_path: h.movie.poster_path })
    entries.push({ kind: 'person', name: h.person.person_name, profile_path: h.person.profile_path })
  }
  return entries
}

function ChainTimeline({ startPerson, chain }: { startPerson: PersonSummary; chain: Hop[] }) {
  const entries = buildChainEntries(startPerson, chain)
  return (
    <View style={s.chainWrap}>
      <Text style={s.sectionLabel}>Your Chain</Text>
      {entries.map((e, i) => (
        <FadeInUp key={i}>
          <View style={s.chainEntryRow}>
            <View style={s.chainStepBadge}><Text style={s.chainStepBadgeText}>{i + 1}</Text></View>
            {e.kind === 'person' ? (
              e.profile_path ? (
                <Image source={{ uri: `${TMDB_PROFILE}${e.profile_path}` }} style={s.chainEntryAvatar} />
              ) : (
                <View style={s.chainEntryAvatar}><Avatar name={e.name} size={28} /></View>
              )
            ) : e.poster_path ? (
              <Image source={{ uri: `${TMDB_POSTER_THUMB}${e.poster_path}` }} style={s.chainEntryPoster} />
            ) : (
              <View style={[s.chainEntryPoster, s.chainEntryPosterFallback]} />
            )}
            <Text
              style={e.kind === 'person' ? s.chainEntryPersonText : s.chainEntryMovieText}
              numberOfLines={1}
            >
              {e.kind === 'person' ? e.name : e.title}
            </Text>
          </View>
        </FadeInUp>
      ))}
    </View>
  )
}

function SmallHeadshot({ person }: { person: PersonSummary }) {
  return (
    <View style={s.smallHeadshotCard}>
      {person.profile_path ? (
        <Image source={{ uri: `${TMDB_PROFILE}${person.profile_path}` }} style={s.smallHeadshotImg} />
      ) : (
        <View style={[s.smallHeadshotImg, s.bigHeadshotFallback]}>
          <Avatar name={person.name} size={32} />
        </View>
      )}
      <Text style={s.smallHeadshotName} numberOfLines={1}>{person.name}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: Spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  practicePill: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  practicePillText: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  playAgainBtn: { backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  playAgainText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  kav: { flex: 1 },
  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: 100, gap: Spacing.lg },
  solvedScroll: { paddingHorizontal: Spacing.lg, paddingBottom: 100, paddingTop: 40, gap: Spacing.lg },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 15, color: Colors.textMuted, textAlign: 'center' },
  empty: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },

  trophyBadge: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.brand,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  solvedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginVertical: Spacing.sm },
  smallHeadshotCard: { alignItems: 'center', width: 88, gap: 6 },
  smallHeadshotImg: { width: 72, height: 108, borderRadius: 10, backgroundColor: Colors.card },
  smallHeadshotName: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' },

  matchupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  bigHeadshotCard: { alignItems: 'center', width: HEADSHOT_W, gap: 8 },
  bigHeadshotImg: { width: HEADSHOT_W, height: HEADSHOT_H, borderRadius: 16, backgroundColor: Colors.card },
  bigHeadshotFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  bigHeadshotName: { fontSize: 14, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  connectorBadge: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.brand,
    alignItems: 'center', justifyContent: 'center', marginBottom: 28,
  },

  chainWrap: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: Spacing.md, gap: Spacing.sm,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2,
  },
  chainStepBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  chainStepBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  chainEntryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  chainEntryPoster: { width: 32, height: 48, borderRadius: 6, backgroundColor: Colors.background },
  chainEntryPosterFallback: { borderWidth: 1, borderColor: Colors.border },
  chainEntryAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  chainEntryPersonText: { fontSize: 14, fontWeight: '600', color: Colors.text, flex: 1 },
  chainEntryMovieText: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', flex: 1 },

  turnCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.brand,
    borderRadius: 16, padding: Spacing.sm,
  },
  turnAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.background },
  turnAvatarFallback: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  turnLabel: { fontSize: 11, color: Colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  turnName: { fontSize: 17, fontWeight: '700', color: Colors.text },

  inputWrap: { gap: Spacing.sm },
  stepLabel: { fontSize: 13, color: Colors.textMuted },
  changeLink: { fontSize: 13, color: Colors.brand },
  selectedMovieCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: Spacing.sm,
  },
  selectedMoviePoster: { width: 40, height: 60, borderRadius: 6, backgroundColor: Colors.background },
  selectedMoviePosterFallback: { borderWidth: 1, borderColor: Colors.border },
  selectedMovieTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  errorText: { fontSize: 13, color: Colors.error },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12,
  },
  resultRowPressed: { backgroundColor: Colors.card },
  resultThumb: { width: 32, height: 48, borderRadius: 5, backgroundColor: Colors.card },
  resultThumbFallback: { borderWidth: 1, borderColor: Colors.border },
  resultAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card },
  resultText: { fontSize: 14, color: Colors.text, flex: 1 },
})
