import { useState, useEffect, useRef } from 'react'
import { View, Text, Pressable, Image, ActivityIndicator, ScrollView, Animated, Dimensions, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w342'

// Approximate height of the NativeTabs bottom bar -- content needs at least
// this much bottom clearance at rest or it renders (unreachably) behind it.
// Same constant/fix as the six-degrees screen (mobile/src/app/(app)/games/six-degrees.tsx).
const TAB_BAR_CLEARANCE = 56

// Poster size computed from screen width (same approach as six-degrees.tsx's
// HEADSHOT_W) rather than a single hardcoded guess, so 3 columns use the
// available width fully across device sizes instead of under-sizing on
// larger phones to stay safe on the smallest ones.
const SCREEN_W = Dimensions.get('window').width
const GRID_COLS = 3
const GRID_PADDING = Spacing.md
const GRID_GAP = 6
const POSTER_W = Math.floor((SCREEN_W - GRID_PADDING * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS)
const POSTER_H = Math.floor(POSTER_W * 1.5)

interface GridMovie {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface RevealMovie {
  id: number
  title: string
  rt_score: number
}

interface RevealResult {
  movies: RevealMovie[]
  total: number
  distance: number
  best_distance: number
  is_new_best: boolean
}

export default function TrifectaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [grid, setGrid] = useState<GridMovie[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [result, setResult] = useState<RevealResult | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [lastRevealedIds, setLastRevealedIds] = useState<number[]>([])

  async function loadGrid(excludeIds: number[] = []) {
    setLoading(true)
    setError(false)
    setSelectedIds([])
    setResult(null)
    try {
      const res = await apiFetch(`/api/games/trifecta/grid?exclude=${excludeIds.join(',')}`)
      if (!res.ok) { setError(true); return }
      const data = await res.json()
      setGrid(data.movies)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGrid() }, [])

  async function selectMovie(movie: GridMovie) {
    if (result || revealing) return
    if (selectedIds.includes(movie.id)) {
      setSelectedIds(selectedIds.filter(id => id !== movie.id))
      return
    }
    if (selectedIds.length >= 3) return

    const nextSelected = [...selectedIds, movie.id]
    setSelectedIds(nextSelected)

    if (nextSelected.length === 3) {
      setRevealing(true)
      try {
        const res = await apiFetch('/api/games/trifecta/reveal', {
          method: 'POST',
          body: JSON.stringify({ movie_ids: nextSelected }),
        })
        if (res.ok) {
          const data: RevealResult = await res.json()
          setResult(data)
          setLastRevealedIds(nextSelected)
        }
      } finally {
        setRevealing(false)
      }
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

  if (error || grid.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} onRefresh={() => loadGrid()} />
        <Text style={s.empty}>Couldn&rsquo;t load a grid — try refreshing.</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} onRefresh={() => loadGrid(result ? lastRevealedIds : [])} />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}>
        <View style={s.header}>
          <Text style={s.heading}>Trifecta</Text>
          <Text style={s.sub}>3 movies, 1 target: hit a combined Rotten Tomatoes score of 150.</Text>
        </View>

        <View style={s.grid}>
          {grid.map(movie => {
            const selected = selectedIds.includes(movie.id)
            return (
              <Pressable
                key={movie.id}
                onPress={() => selectMovie(movie)}
                disabled={!!result || revealing}
                style={[s.poster, selected && s.posterSelected]}
              >
                {movie.poster_path ? (
                  <Image source={{ uri: `${TMDB_POSTER}${movie.poster_path}` }} style={s.posterImg} />
                ) : (
                  <View style={[s.posterImg, s.posterFallback]}>
                    <Text style={s.posterFallbackText} numberOfLines={3}>{movie.title}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>

      </ScrollView>

      {revealing && (
        <View style={s.overlayBackdrop} pointerEvents="box-none">
          <ActivityIndicator size="large" color={Colors.brand} />
        </View>
      )}

      {result && (
        <RevealOverlay result={result} grid={grid} router={router} onNewGrid={() => loadGrid(lastRevealedIds)} />
      )}
    </SafeAreaView>
  )
}

function RevealOverlay({
  result, grid, onNewGrid, router,
}: {
  result: RevealResult; grid: GridMovie[]; onNewGrid: () => void; router: ReturnType<typeof useRouter>
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.9)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, useNativeDriver: true }),
    ]).start()
  }, [])

  const posterById = new Map(grid.map(m => [m.id, m.poster_path]))

  return (
    <View style={s.overlayBackdrop} pointerEvents="box-none">
      <Animated.View style={[s.overlayCard, { opacity, transform: [{ scale }] }]}>
        <View style={s.overlayPosterRow}>
          {result.movies.map(m => {
            const posterPath = posterById.get(m.id)
            return (
              <View key={m.id} style={s.overlayPosterCol}>
                {posterPath ? (
                  <Image source={{ uri: `${TMDB_POSTER}${posterPath}` }} style={s.overlayPoster} />
                ) : (
                  <View style={[s.overlayPoster, s.posterFallback]} />
                )}
                <Text style={s.overlayPosterScore}>{m.rt_score}%</Text>
              </View>
            )
          })}
        </View>
        <Text style={s.overlayTotal}>{result.total}</Text>
        <Text style={s.overlayTarget}>target: 150</Text>
        <Text style={s.overlayDistance}>
          {result.distance === 0 ? 'Exact match! \u{1F3AF}' : `${result.distance} away`}
        </Text>
        {result.is_new_best && <Text style={s.newBest}>New personal best!</Text>}
        <Text style={s.bestDistance}>Personal best: {result.best_distance}</Text>
        <Pressable style={s.overlayButton} onPress={onNewGrid}>
          <RefreshCw size={16} color={Colors.background} />
          <Text style={s.overlayButtonText}>New grid</Text>
        </Pressable>
        <Pressable style={s.overlayBackLink} onPress={() => router.back()}>
          <Text style={s.overlayBackLinkText}>&larr; Back to Games</Text>
        </Pressable>
      </Animated.View>
    </View>
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
        <Text style={s.refreshText}>New grid</Text>
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
    flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, justifyContent: 'center',
    paddingHorizontal: GRID_PADDING, paddingTop: Spacing.md,
  },
  poster: {
    width: POSTER_W, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  posterSelected: { borderColor: Colors.brand },
  posterImg: { width: POSTER_W, height: POSTER_H, backgroundColor: Colors.card },
  posterFallback: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  posterFallbackText: { fontSize: 11, color: Colors.textFaint, textAlign: 'center' },
  overlayBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  overlayCard: {
    width: '100%', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 20, padding: Spacing.lg, alignItems: 'center', gap: 2,
  },
  overlayPosterRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  overlayPosterCol: { alignItems: 'center', gap: 4 },
  overlayPoster: { width: 56, height: 84, borderRadius: 6, backgroundColor: Colors.background },
  overlayPosterScore: { fontSize: 13, fontWeight: '700', color: Colors.text },
  overlayTotal: { fontSize: 34, fontWeight: '800', color: Colors.text },
  overlayTarget: { fontSize: 13, color: Colors.textMuted },
  overlayDistance: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary, marginTop: 8 },
  newBest: { fontSize: 14, fontWeight: '700', color: Colors.brand, marginTop: 8 },
  bestDistance: { fontSize: 12, color: Colors.textFaint, marginTop: 6 },
  overlayButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24,
    marginTop: Spacing.lg,
  },
  overlayButtonText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  overlayBackLink: { marginTop: Spacing.md, paddingVertical: 4 },
  overlayBackLinkText: { fontSize: 13, color: Colors.textMuted },
})
