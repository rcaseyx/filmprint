import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView,
  StyleSheet, Animated, Dimensions, Keyboard, Platform, PanResponder,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ArrowRight, Trophy, RefreshCw } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { Avatar } from '@/components/Avatar'
import { useDebounce } from '@/lib/useDebounce'
import { apiFetch } from '@/lib/api'

const TMDB_PROFILE = 'https://image.tmdb.org/t/p/w185'
const TMDB_POSTER_THUMB = 'https://image.tmdb.org/t/p/w154'
const SCREEN_W = Dimensions.get('window').width
const HEADSHOT_W = Math.floor((SCREEN_W - Spacing.lg * 2 - 56) / 2)
const HEADSHOT_H = Math.floor(HEADSHOT_W * 1.5)
// Approximate height of the NativeTabs bottom bar -- content needs at least
// this much bottom clearance at rest or it renders (unreachably) behind it.
const TAB_BAR_CLEARANCE = 56

// No real iPhone keyboard (even with the predictive-text bar) exceeds this in
// portrait -- clamping to it means a bad/oversized reading from the OS can
// never push the input panel further than this, regardless of the cause.
const MAX_KEYBOARD_LIFT = 400

// How close the panel should sit to the top of the keyboard once lifted.
const KEYBOARD_GAP = 8

// Tracks how far to lift the input panel (a negative translateY, synced to
// the keyboard's own show/hide animation curve/duration) so it clears the
// keyboard -- iOS only, since Android resizes the window natively via
// adjustResize and needs no manual offset. This intentionally avoids both
// KeyboardAvoidingView and automaticallyAdjustKeyboardInsets: both measure
// position through the view hierarchy to compute their offset, and that
// measurement is unreliable inside NativeTabs (see the picks-screen
// keyboard-squish fix in 9ab92a7). Tracking the OS-reported keyboard height
// directly sidesteps that class of bug -- but is clamped defensively in case
// the reported height is ever wrong, since an unbounded lift is far worse
// (pushes the whole panel off-screen) than a slightly-imperfect one.
//
// restBottomPadding is the panel's own resting paddingBottom (tab-bar
// clearance). The panel only needs to lift by however much the keyboard
// EXCEEDS that padding -- lifting by the full keyboard height on top of
// padding that's already there double-counts it, leaving that same amount
// of dead space between the panel and the keyboard.
function useKeyboardLift(restBottomPadding: number) {
  const lift = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      const height = Math.min(Math.max(e.endCoordinates?.height ?? 0, 0), MAX_KEYBOARD_LIFT)
      const extraLift = Math.max(height - restBottomPadding, 0)
      Animated.timing(lift, { toValue: -(extraLift + KEYBOARD_GAP), duration: e.duration || 250, useNativeDriver: true }).start()
    })
    const hideSub = Keyboard.addListener('keyboardWillHide', e => {
      Animated.timing(lift, { toValue: 0, duration: e.duration || 250, useNativeDriver: true }).start()
    })
    return () => { showSub.remove(); hideSub.remove() }
  }, [restBottomPadding])
  return lift
}

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

interface PuzzleResponse {
  start_person: PersonSummary
  end_person: PersonSummary
  optimal_degree_count?: number
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
  const insets = useSafeAreaInsets()
  const restBottomPadding = insets.bottom + TAB_BAR_CLEARANCE
  const keyboardLift = useKeyboardLift(restBottomPadding)

  // The panel only needs to get out of the way while the keyboard is up --
  // at rest (no keyboard) it's already just pinned to the bottom, not
  // covering much of the board. So "see what's behind it" just means
  // dismissing the keyboard, which keyboardLift above already animates
  // smoothly (it's driven by the real native keyboard show/hide event, so
  // it's inherently tactile -- no separate fake "collapsed" sheet state to
  // fake-animate, and nothing for a live drag-tracking value to lag behind).
  // Swiping the handle, or just tapping it, dismisses the keyboard -- a
  // no-op if it's already closed, so there's no need to distinguish gesture
  // direction or distance.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: () => Keyboard.dismiss(),
    })
  ).current

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [puzzle, setPuzzle] = useState<PuzzleResponse | null>(null)

  const [currentPerson, setCurrentPerson] = useState<PersonResult | null>(null)
  const [visitedMovieIds, setVisitedMovieIds] = useState<number[]>([])
  const [visitedPersonIds, setVisitedPersonIds] = useState<number[]>([])
  const [chain, setChain] = useState<Hop[]>([])
  const [guessPath, setGuessPath] = useState<{ person_id: number; movie_id: number; next_person_id: number }[]>([])
  const queryInputRef = useRef<TextInput>(null)
  const historyScrollRef = useRef<ScrollView>(null)
  const solvedScrollRef = useRef<ScrollView>(null)

  const [movieQuery, setMovieQuery] = useState('')
  const [movieResults, setMovieResults] = useState<MovieSummary[]>([])
  const [selectedMovie, setSelectedMovie] = useState<MovieSummary | null>(null)
  const [movieError, setMovieError] = useState<string | null>(null)
  const [actorQuery, setActorQuery] = useState('')
  const [actorResults, setActorResults] = useState<PersonResult[]>([])
  const [actorError, setActorError] = useState<string | null>(null)

  const [solved, setSolved] = useState<{ degree_count: number; six_degrees_solved_count?: number } | null>(null)
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
      const r = await apiFetch('/api/games/six-degrees/puzzle')
      if (!r.ok) { setNotFound(true); return }
      const data: PuzzleResponse = await r.json()
      setPuzzle(data)
      setCurrentPerson({
        person_id: data.start_person.id,
        person_name: data.start_person.name,
        profile_path: data.start_person.profile_path,
      })
      setVisitedPersonIds([data.start_person.id])
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPuzzle() }, [])

  // Context changes (a new current actor, or entering/leaving the movie step)
  // fully invalidate whatever's currently displayed.
  useEffect(() => {
    setMovieResults([])
    setMovieError(null)
  }, [currentPerson?.person_id, selectedMovie])

  // Dismiss a stale "wasn't in that movie" error as soon as the user starts
  // typing again, and clear results once below the search threshold -- but
  // don't clear results on every keystroke otherwise. The debounced search
  // below simply replaces movieResults when it resolves, so the list narrows
  // as you type instead of blanking out and popping back in on each character.
  useEffect(() => {
    setMovieError(null)
    if (movieQuery.trim().length < 2) setMovieResults([])
  }, [movieQuery])

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
  }, [selectedMovie])

  useEffect(() => {
    setActorError(null)
    if (actorQuery.trim().length < 2) setActorResults([])
  }, [actorQuery])

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

  // Reveal each new connection as it's found, since the growing chain can
  // push earlier entries out of view.
  useEffect(() => {
    if (chain.length === 0) return
    const t = setTimeout(() => historyScrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [chain.length])

  // On longer chains the solved screen could otherwise render already
  // scrolled down (e.g. residual scroll-adjustment while the keyboard was
  // still closing) instead of showing the "Solved!" heading at the top.
  useEffect(() => {
    if (!solved) return
    Keyboard.dismiss()
    solvedScrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [solved])

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
        const res = await apiFetch('/api/games/six-degrees/puzzle/attempt', {
          method: 'POST',
          body: JSON.stringify({
            start_person_id: puzzle.start_person.id,
            end_person_id: puzzle.end_person.id,
            guess_path: newGuessPath,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setSolved({ degree_count: data.degree_count, six_degrees_solved_count: data.six_degrees_solved_count })
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
        <BackBar router={router} />
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.textMuted} />
      </SafeAreaView>
    )
  }

  if (notFound || !puzzle) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <Text style={s.empty}>Couldn&rsquo;t load a puzzle — try refreshing.</Text>
      </SafeAreaView>
    )
  }

  if (solved) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <ScrollView
          ref={solvedScrollRef}
          contentContainerStyle={[s.solvedScroll, { paddingBottom: restBottomPadding }]}
          keyboardShouldPersistTaps="handled"
        >
          <FadeInUp style={s.center}>
            <View style={s.trophyBadge}>
              <Trophy size={30} color={Colors.background} strokeWidth={2} />
            </View>
            <Text style={s.heading}>Solved!</Text>
            <Text style={s.sub}>{solved.degree_count} degree{solved.degree_count === 1 ? '' : 's'}</Text>
            {puzzle.optimal_degree_count != null && (
              <Text style={s.optimalText}>Shortest possible path: {puzzle.optimal_degree_count} degree{puzzle.optimal_degree_count === 1 ? '' : 's'}</Text>
            )}
            {solved.six_degrees_solved_count != null && (
              <Text style={s.optimalText}>Puzzles solved: {solved.six_degrees_solved_count}</Text>
            )}
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
          <Pressable style={s.playAgainBtn} onPress={loadPuzzle}>
            <Text style={s.playAgainText}>Play again</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} />

      {/* History: matchup + chain only. Scrolls independently above the fixed
          input area below, so it never competes for scroll position with it.
          Auto-scrolls to reveal each new connection as it's found. */}
      <ScrollView
        ref={historyScrollRef}
        style={s.historyScrollFlex}
        contentContainerStyle={s.historyScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.matchupRow}>
          <BigHeadshot person={puzzle.start_person} />
          <View style={s.connectorCol}>
            <View style={s.connectorBadge}>
              <ArrowRight size={18} color={Colors.background} strokeWidth={2.5} />
            </View>
            <Pressable style={s.refreshBtn} onPress={loadPuzzle} hitSlop={10}>
              <RefreshCw size={20} color={Colors.textMuted} />
            </Pressable>
          </View>
          <BigHeadshot person={puzzle.end_person} />
        </View>

        {chain.length > 0 && <ChainTimeline startPerson={puzzle.start_person} chain={chain} />}
      </ScrollView>

      {/* Input area: floats over the history (position: absolute), not a flex
          sibling competing with it for space -- otherwise adding the keyboard's
          height as padding just balloons this box and crushes history down to
          nothing once results make it tall. Sits pinned to the screen bottom
          at rest (padded to clear the NativeTabs bar) and slides up via
          translateY when the keyboard opens, so its own content height never
          affects how much room history gets. */}
      <Animated.View
        style={[
          s.inputArea,
          { paddingBottom: restBottomPadding, transform: [{ translateY: keyboardLift }] },
        ]}
      >
        <View {...panResponder.panHandlers} style={s.handleWrap} hitSlop={8}>
          <View style={s.handleBar} />
        </View>

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
          {(submitting || verifying) && <ActivityIndicator color={Colors.textMuted} />}
        </View>

        <View style={s.inputWrap}>
          {/* Selected-movie card only renders when relevant; the query
              TextInput below is a single persistent element shared by both
              steps (movie search and actor search), so switching steps never
              unmounts it -- the keyboard stays open continuously instead of
              closing and reopening as focus is lost and reclaimed. */}
          {selectedMovie && (
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
              <Pressable
                onPress={() => { setSelectedMovie(null); setActorQuery(''); setActorResults([]) }}
                hitSlop={8}
              >
                <Text style={s.changeLink}>change</Text>
              </Pressable>
            </FadeInUp>
          )}

          <Text style={s.stepLabel}>
            {selectedMovie ? 'Name another actor in this movie' : 'Name a movie they were in'}
          </Text>
          <TextInput
            ref={queryInputRef}
            style={s.input}
            placeholder={selectedMovie ? 'Actor name' : 'Movie title'}
            placeholderTextColor={Colors.textFaint}
            value={selectedMovie ? actorQuery : movieQuery}
            onChangeText={selectedMovie ? setActorQuery : setMovieQuery}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {(selectedMovie ? actorError : movieError) && (
            <Text style={s.errorText}>{selectedMovie ? actorError : movieError}</Text>
          )}
          <ScrollView style={s.resultsScroll} keyboardShouldPersistTaps="handled">
            {selectedMovie
              ? actorResults.map(a => (
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
                ))
              : movieResults.map(m => (
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
                ))
            }
          </ScrollView>
        </View>
      </Animated.View>
    </SafeAreaView>
  )
}

function BackBar({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={s.backBar}>
      <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>Games</Text>
      </Pressable>
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
  playAgainBtn: { backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  playAgainText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  historyScrollFlex: { flex: 1 },
  // Bottom padding here is a generous static estimate of the floating input
  // panel's typical resting height, so scrolling history to its end doesn't
  // leave the last chain entry tucked behind the panel.
  historyScroll: { paddingHorizontal: Spacing.lg, paddingBottom: 420, gap: Spacing.lg },
  inputArea: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.sm,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handleBar: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border },
  resultsScroll: { maxHeight: 220 },
  solvedScroll: { paddingHorizontal: Spacing.lg, paddingTop: 40, gap: Spacing.lg },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 15, color: Colors.textMuted, textAlign: 'center' },
  optimalText: { fontSize: 13, color: Colors.textFaint, textAlign: 'center', marginTop: 2 },
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
  connectorCol: { alignItems: 'center', gap: Spacing.xl, marginBottom: 8 },
  connectorBadge: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  refreshBtn: { padding: 4 },

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
