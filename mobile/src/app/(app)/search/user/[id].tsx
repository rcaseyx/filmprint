import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { RadarSection, type Axis, type RadarExamples } from '@/components/RadarSection'
import { PosterCard } from '@/components/PosterCard'
import { InsightCard } from '@/components/InsightCard'
import { SectionLabel } from '@/components/SectionLabel'
import { ProfileSkeleton } from '@/components/ProfileSkeleton'

interface ProfileData {
  ratings_count: number
  watchlist_count: number
  avg_rating: number
  genres: (Axis & { count: number })[]
  decades: Axis[]
  tone: Axis[]
  subgenres: Axis[]
  critic_alignment: number
  quality_floor: number
  neutral: number
  favorites: { id: number; title: string; year: number | null; poster_path: string | null }[]
}

interface HistoryEntry {
  id: number; movie_id: number; title: string; year: number | null
  poster_path: string | null; followed_through: boolean; follow_up_rating: number | null
}

export default function PublicProfileByIdScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const router = useRouter()
  const initialFocus = useRef(true)
  const fadeAnim = useRef(new Animated.Value(0)).current

  useFocusEffect(useCallback(() => {
    if (initialFocus.current) { initialFocus.current = false; return }
    router.back()
  }, []))

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [examples, setExamples] = useState<{
    genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples
  } | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    try {
      const profileRes = await apiFetch(`/api/users/id/${id}`)
      if (profileRes.status === 404) { setNotFound(true); return }
      const [pd, ed, hd] = await Promise.all([
        profileRes.json(),
        apiFetch(`/api/users/id/${id}/examples`).then(r => r.json()),
        apiFetch(`/api/users/id/${id}/history`).then(r => r.json()),
      ])
      setProfile(pd)
      setExamples(ed)
      setHistory(hd.history ?? [])
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!loading && profile && examples) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start()
    }
  }, [loading, profile, examples])

  const displayName = name || `User ${id}`
  const topGenres = profile?.genres.slice(0, 8) ?? []
  const maxGenreW = topGenres[0]?.weight ?? 0.01

  const a = profile?.critic_alignment ?? 0
  const alignLabel =
    a > 2.0 ? 'Much more generous' :
    a > 0.75 ? 'More generous than critics' :
    a > 0.25 ? 'Slightly more generous' :
    a > -0.25 ? 'In sync with critics' :
    a > -0.75 ? 'Slightly tougher' :
    a > -2.0 ? 'Tougher than critics' :
    'Much tougher than critics'
  const stars = Math.abs(a) / 2
  const alignDesc = stars < 0.15
    ? 'Their ratings closely match critics'
    : `~${stars.toFixed(1)}★ ${a > 0 ? 'above' : 'below'} critics avg`

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>People</Text>
      </TouchableOpacity>

      {loading && <ProfileSkeleton bare />}

      {!loading && notFound && (
        <View style={s.errWrap}>
          <Text style={s.errText}>User not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.retryBtn} activeOpacity={0.8}>
            <Text style={s.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !notFound && profile && examples && (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

            <View style={s.headerBlock}>
              <Text style={s.heading}>{displayName}'s taste profile</Text>
              <Text style={s.subheading}>{profile.ratings_count} ratings</Text>
            </View>

            <View style={s.statsRow}>
              {[
                { value: profile.ratings_count.toLocaleString(), label: 'Ratings' },
                { value: profile.watchlist_count.toLocaleString(), label: 'Watchlist' },
                { value: `${profile.avg_rating.toFixed(1)}★`, label: 'Avg rating', brand: true },
              ].map(({ value, label, brand }) => (
                <View key={label} style={s.statCard}>
                  <Text style={[s.statValue, brand && { color: Colors.brand }]}>{value}</Text>
                  <Text style={s.statLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <RadarSection
              genres={topGenres}
              subgenres={profile.subgenres}
              decades={profile.decades}
              tone={profile.tone}
              examples={examples}
            />

            <View style={s.section}>
              <SectionLabel>Genre affinity</SectionLabel>
              <View style={s.bars}>
                {topGenres.map(g => (
                  <View key={g.name} style={s.barRow}>
                    <Text style={s.barName}>{g.name}</Text>
                    <View style={s.barTrack}>
                      <View style={[s.barFill, { width: `${(g.weight / maxGenreW) * 100}%` as any }]} />
                    </View>
                    <Text style={s.barCount}>{g.count}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={s.insightRow}>
              <InsightCard label="Critic alignment" value={alignLabel} sub={alignDesc} />
              <View style={s.insightPair}>
                <InsightCard label="Quality floor" value={profile.quality_floor.toFixed(1)} sub="Min IMDb for candidates" style={{ flex: 1 }} />
                <InsightCard label="Their neutral" value={`${profile.neutral.toFixed(1)}★`} sub="Calibrated from ratings" brandValue style={{ flex: 1 }} />
              </View>
            </View>

            {profile.favorites.length > 0 && (
              <View style={s.section}>
                <SectionLabel>Favorites <Text style={{ color: Colors.brand }}>★★★★★</Text></SectionLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.posterRow}>
                  {profile.favorites.map(f => (
                    <PosterCard key={f.id} id={f.id} title={f.title} year={f.year} poster_path={f.poster_path} />
                  ))}
                </ScrollView>
              </View>
            )}

            {history.length > 0 && (
              <View style={s.section}>
                <SectionLabel>Past picks</SectionLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.posterRow}>
                  {history.map(entry => (
                    <PosterCard
                      key={entry.id}
                      id={entry.movie_id}
                      title={entry.title}
                      year={entry.year}
                      poster_path={entry.poster_path}
                      badge={
                        entry.followed_through ? (
                          entry.follow_up_rating ? (
                            <Text style={s.badgeStars}>
                              {'★'.repeat(Math.floor(entry.follow_up_rating))}
                              {entry.follow_up_rating % 1 >= 0.5 ? '½' : ''}
                            </Text>
                          ) : (
                            <Text style={s.badgeWatched}>Watched</Text>
                          )
                        ) : undefined
                      }
                    />
                  ))}
                </ScrollView>
              </View>
            )}

          </ScrollView>
        </Animated.View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: 100, paddingTop: Spacing.sm, gap: 28 },
  headerBlock: { gap: 4 },
  heading: { fontSize: 24, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  subheading: { fontSize: 13, color: Colors.textMuted },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  statValue: { fontSize: 26, fontWeight: '600', color: Colors.text },
  statLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.6 },
  section: { gap: 12 },
  bars: { gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barName: { width: 110, fontSize: 13, color: Colors.textSecondary },
  barTrack: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.brand, borderRadius: 99 },
  barCount: { width: 28, fontSize: 11, color: Colors.textFaint, textAlign: 'right' },
  insightRow: { flexDirection: 'column', gap: 8 },
  insightPair: { flexDirection: 'row', gap: 8 },
  posterRow: { gap: 10 },
  badgeStars: { fontSize: 11, color: Colors.brand },
  badgeWatched: { fontSize: 10, color: '#4ade80' },
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errText: { fontSize: 16, color: Colors.textMuted },
  retryBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryText: { fontSize: 14, color: Colors.textSecondary },
})
