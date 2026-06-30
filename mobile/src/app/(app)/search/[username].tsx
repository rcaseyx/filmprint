import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Animated,
  Modal, Pressable, PanResponder,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { RadarSection, type Axis, type RadarExamples } from '@/components/RadarSection'
import { PosterCard } from '@/components/PosterCard'
import { InsightCard } from '@/components/InsightCard'
import { SectionLabel } from '@/components/SectionLabel'
import { ProfileSkeleton } from '@/components/ProfileSkeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  ratings_count: number
  watchlist_count: number
  avg_rating: number
  fp_score?: number
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>()
  const router = useRouter()
  const initialFocus = useRef(true)
  const fadeAnim = useRef(new Animated.Value(0)).current

  // Reset to search root when returning to People tab from another tab
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
  const [activeSheet, setActiveSheet] = useState<'score' | 'alignment' | 'neutral' | null>(null)
  const overlayAnim = useRef(new Animated.Value(0)).current
  const sheetAnim = useRef(new Animated.Value(400)).current

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 0,
      onPanResponderMove: (_, { dy }) => { if (dy > 0) sheetAnim.setValue(dy) },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          Animated.parallel([
            Animated.timing(overlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
            Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
          ]).start(() => setActiveSheet(null))
        } else {
          Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }).start()
        }
      },
    })
  ).current

  const openSheet = (sheet: 'score' | 'alignment' | 'neutral') => {
    setActiveSheet(sheet)
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }),
    ]).start()
  }

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
    ]).start(() => setActiveSheet(null))
  }

  const load = useCallback(async () => {
    if (!username) return
    setLoading(true)
    setNotFound(false)
    try {
      const profileRes = await apiFetch(`/api/users/${encodeURIComponent(username)}`)
      if (profileRes.status === 404) { setNotFound(true); return }
      const [pd, ed, hd] = await Promise.all([
        profileRes.json(),
        apiFetch(`/api/users/${encodeURIComponent(username)}/examples`).then(r => r.json()),
        apiFetch(`/api/users/${encodeURIComponent(username)}/history`).then(r => r.json()),
      ])
      setProfile(pd)
      setExamples(ed)
      setHistory(hd.history ?? [])
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [username])

  useEffect(() => { load() }, [load])

  // Fade content in once loaded
  useEffect(() => {
    if (!loading && profile && examples) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start()
    }
  }, [loading, profile, examples])

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

      {/* Back button — always pinned at top, same position during loading and loaded */}
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>People</Text>
      </TouchableOpacity>

      {/* Skeleton — visible while loading */}
      {loading && <ProfileSkeleton bare />}

      {/* Error */}
      {!loading && notFound && (
        <View style={s.errWrap}>
          <Text style={s.errText}>User not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.retryBtn} activeOpacity={0.8}>
            <Text style={s.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Content — fades in once loaded */}
      {!loading && !notFound && profile && examples && (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

            <View style={s.headerBlock}>
              <Text style={s.heading}>{username}'s taste profile</Text>
              <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(`https://letterboxd.com/${username}/`)} activeOpacity={0.7}>
                <Text style={s.subheading}>
                  {profile.ratings_count} ratings · <Text style={s.lbLink}>View on Letterboxd ↗</Text>
                </Text>
              </TouchableOpacity>
            </View>

            {/* Stats */}
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

            {/* Radar */}
            <RadarSection
              genres={topGenres}
              subgenres={profile.subgenres}
              decades={profile.decades}
              tone={profile.tone}
              examples={examples}
            />

            {/* Genre affinity bars */}
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

            {/* Insight cards */}
            <View style={s.insightRow}>
              <InsightCard label="Critic alignment" value={alignLabel} sub={alignDesc} onPress={() => openSheet('alignment')} />
              <View style={s.insightPair}>
                <InsightCard label="Their neutral" value={`${profile.neutral.toFixed(1)}★`} brandValue style={{ flex: 1 }} onPress={() => openSheet('neutral')} />
                <InsightCard label="Filmprint Score" value={String(profile.fp_score ?? '—')} brandValue style={{ flex: 1 }} onPress={() => openSheet('score')} />
              </View>
            </View>

            {/* Favorites */}
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

            {/* Past picks */}
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

      {/* Insight sheet */}
      <Modal visible={activeSheet !== null} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
        <Animated.View style={[StyleSheet.absoluteFill, s.sheetOverlayBg, { opacity: overlayAnim }]} />
        <View style={s.sheetContainer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
          <Animated.View style={[s.sheet, { transform: [{ translateY: sheetAnim }] }]} {...panResponder.panHandlers}>
            <View style={s.dragHandle} />
            {activeSheet === 'alignment' && (
              <>
                <View style={s.sheetHeader}>
                  <Text style={s.sheetTitle}>Critic alignment</Text>
                </View>
                <Text style={s.scoreSheetValue}>{alignLabel}</Text>
                <View style={s.breakdownList}>
                  <View style={s.breakdownItem}>
                    <Text style={s.breakdownDesc}>Compares their star ratings to Letterboxd critic scores for the same films. A positive alignment means they tend to rate films higher than critics; negative means they're tougher.</Text>
                  </View>
                </View>
              </>
            )}
            {activeSheet === 'neutral' && (
              <>
                <View style={s.sheetHeader}>
                  <Text style={s.sheetTitle}>Their neutral</Text>
                </View>
                <Text style={s.scoreSheetValue}>{profile?.neutral.toFixed(1)}<Text style={s.scoreSheetDenom}>★</Text></Text>
                <View style={s.breakdownList}>
                  <View style={s.breakdownItem}>
                    <Text style={s.breakdownDesc}>The rating that represents a "meh" for them — neither a recommendation nor a rejection. Filmprint calibrates this from their full ratings distribution.</Text>
                  </View>
                  <View style={s.breakdownItem}>
                    <Text style={s.breakdownDesc}>Films they rate at or above this threshold are treated as positive signals when building their taste profile.</Text>
                  </View>
                </View>
              </>
            )}
            {activeSheet === 'score' && (
              <>
                <View style={s.sheetHeader}>
                  <Text style={s.sheetTitle}>Filmprint Score</Text>
                </View>
                <Text style={s.scoreSheetValue}>
                  {profile?.fp_score ?? 0}<Text style={s.scoreSheetDenom}>/1000</Text>
                </Text>
                <View style={s.breakdownList}>
                  {[
                    { label: 'Depth', pts: '0–500 pts', desc: 'More films rated = more points, on a curve. Going from 100 to 500 ratings earns more than going from 1,500 to 2,000.' },
                    { label: 'Genre diversity', pts: '0–300 pts', desc: 'Measures how spread your taste is across genres. Watching broadly across 10 genres scores higher than watching almost exclusively one or two.' },
                    { label: 'Decade diversity', pts: '0–200 pts', desc: 'Measures how broadly you explore different eras. Watching films from across cinema history scores higher than sticking mostly to recent releases.' },
                  ].map(({ label, pts, desc }) => (
                    <View key={label} style={s.breakdownItem}>
                      <View style={s.breakdownRow}>
                        <Text style={s.breakdownLabel}>{label}</Text>
                        <Text style={s.breakdownPts}>{pts}</Text>
                      </View>
                      <Text style={s.breakdownDesc}>{desc}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>

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
  lbLink: { color: Colors.textSecondary },
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
  sheetOverlayBg: { backgroundColor: 'rgba(0,0,0,0.75)' },
  sheetContainer: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 28, paddingBottom: 48, gap: 16,
    borderWidth: 1, borderBottomWidth: 0, borderColor: Colors.border,
  },
  dragHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 99, alignSelf: 'center', marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: Colors.text },
  scoreSheetValue: { fontSize: 48, fontWeight: '700', color: Colors.text },
  scoreSheetDenom: { fontSize: 20, fontWeight: '400', color: Colors.textMuted },
  breakdownList: { gap: 16, marginTop: 4 },
  breakdownItem: { gap: 4 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  breakdownPts: { fontSize: 12, color: Colors.textFaint },
  breakdownDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  posterRow: { gap: 10 },
  badgeStars: { fontSize: 11, color: Colors.brand },
  badgeWatched: { fontSize: 10, color: '#4ade80' },
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errText: { fontSize: 16, color: Colors.textMuted },
  retryBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryText: { fontSize: 14, color: Colors.textSecondary },
})
