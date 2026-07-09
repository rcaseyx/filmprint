import { useState, useEffect } from 'react'
import { View, Text, Pressable, Image, ActivityIndicator, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w342'

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

  const scoreById = new Map(result?.movies.map(m => [m.id, m.rt_score]) ?? [])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <BackBar router={router} onRefresh={() => loadGrid(result ? lastRevealedIds : [])} />

      <View style={s.header}>
        <Text style={s.heading}>Trifecta</Text>
        <Text style={s.sub}>Pick 3 movies. Get their Rotten Tomatoes scores as close to 150 as possible.</Text>
      </View>

      <View style={s.grid}>
        {grid.map(movie => {
          const selected = selectedIds.includes(movie.id)
          const score = scoreById.get(movie.id)
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
              {score != null && (
                <View style={s.scoreBadge}>
                  <Text style={s.scoreBadgeText}>{score}%</Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </View>

      {revealing && <ActivityIndicator style={{ marginTop: Spacing.md }} color={Colors.textMuted} />}

      {result && (
        <View style={s.resultCard}>
          <Text style={s.resultTotal}>
            {result.total} <Text style={s.resultTarget}>(target: 150)</Text>
          </Text>
          <Text style={s.resultDistance}>
            {result.distance === 0 ? 'Exact match!' : `${result.distance} away`}
          </Text>
          {result.is_new_best && <Text style={s.newBest}>New personal best!</Text>}
          <Text style={s.bestDistance}>Personal best: {result.best_distance}</Text>
        </View>
      )}
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
  sub: { fontSize: 13, color: Colors.textMuted },
  empty: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
  },
  poster: {
    width: 104, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  posterSelected: { borderColor: Colors.brand },
  posterImg: { width: 104, height: 156, backgroundColor: Colors.card },
  posterFallback: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  posterFallbackText: { fontSize: 11, color: Colors.textFaint, textAlign: 'center' },
  scoreBadge: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)', paddingVertical: 4, alignItems: 'center',
  },
  scoreBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  resultCard: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.lg,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: Spacing.md, alignItems: 'center', gap: 2,
  },
  resultTotal: { fontSize: 18, fontWeight: '700', color: Colors.text },
  resultTarget: { fontSize: 14, fontWeight: '400', color: Colors.textMuted },
  resultDistance: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  newBest: { fontSize: 14, fontWeight: '700', color: Colors.brand, marginTop: 6 },
  bestDistance: { fontSize: 12, color: Colors.textFaint, marginTop: 6 },
})
