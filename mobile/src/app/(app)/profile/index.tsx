import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, Pressable, Animated, PanResponder,
} from 'react-native'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { RefreshCw, LogOut, Link2, HelpCircle, Sparkles, ChevronRight, Share2 } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { RadarSection, type Axis, type RadarExamples } from '@/components/RadarSection'
import { StoryCard, CARD_W } from '@/components/StoryCard'
import { PosterCard } from '@/components/PosterCard'
import { InsightCard } from '@/components/InsightCard'
import { SectionLabel } from '@/components/SectionLabel'
import { ProfileSkeleton } from '@/components/ProfileSkeleton'
import { ProfileBuilding } from '@/components/ProfileBuilding'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  ratings_count: number
  watchlist_count: number
  avg_rating: number
  summary: string | null
  ai_summary: string | null
  genres: (Axis & { count: number })[]
  decades: Axis[]
  tone: Axis[]
  subgenres: Axis[]
  directors: (Axis & { shortName: string })[]
  critic_alignment: number
  quality_floor: number
  neutral: number
  favorites: { id: number; title: string; year: number | null; poster_path: string | null }[]
}

interface HistoryEntry {
  id: number; movie_id: number; title: string; year: number | null
  recommended_at: string | null; poster_path: string | null
  genres: string[]; followed_through: boolean; follow_up_rating: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 30) return `${diff}d ago`
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`
  return `${Math.floor(diff / 365)}y ago`
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { logout } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [rebuildInProgress, setRebuildInProgress] = useState(false)
  const [currentUsername, setCurrentUsername] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [examples, setExamples] = useState<{
    genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples
  } | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [needsUsername, setNeedsUsername] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [sharing, setSharing] = useState(false)
  const overlayAnim = useRef(new Animated.Value(0)).current
  const sheetAnim = useRef(new Animated.Value(400)).current
  const storyCardRef = useRef<View>(null)

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 0,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) sheetAnim.setValue(dy)
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          Animated.parallel([
            Animated.timing(overlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
            Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
          ]).start(() => setSummaryVisible(false))
        } else {
          Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }).start()
        }
      },
    })
  ).current

  const handleShare = async () => {
    if (!profile || !currentUsername || sharing) return
    setSharing(true)
    try {
      const uri = await captureRef(storyCardRef, { format: 'png', quality: 1 })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your filmprint' })
    } catch (e) {
      console.warn('[share]', e)
    } finally {
      setSharing(false)
    }
  }

  const openSheet = () => {
    setSummaryVisible(true)
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }),
    ]).start()
  }

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
    ]).start(() => setSummaryVisible(false))
  }
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const ud = await apiFetch('/api/user').then(r => r.json())
      setCurrentUsername(ud.username ?? null)
      if (ud.rebuild_in_progress) {
        setRebuildInProgress(true)
        setLoading(false)
        return
      }
      setNeedsUsername(ud.needs_username)
      const [pd, ed, hd] = await Promise.all([
        apiFetch('/api/profile').then(r => r.json()),
        apiFetch('/api/profile/examples').then(r => r.json()),
        apiFetch('/api/recommendations/history').then(r => r.json()),
      ])
      setProfile(pd)
      setExamples(ed)
      setHistory(hd.history ?? [])
      setRebuildInProgress(false)
    } catch {
      // leave null
    } finally {
      setLoading(false)
    }
  }, [])

  const initialFocus = useRef(true)

  useEffect(() => { load() }, [load])

  useEffect(() => () => { if (syncPollRef.current) clearInterval(syncPollRef.current) }, [])

  // Silent refresh on re-focus so profile updates after connecting Letterboxd
  useFocusEffect(useCallback(() => {
    if (initialFocus.current) { initialFocus.current = false; return }
    load()
  }, [load]))

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg('Syncing in background…')
    try {
      const r = await apiFetch('/api/sync', { method: 'POST' })
      const data = await r.json()
      if (data.rebuild_status === 'pending') {
        syncPollRef.current = setInterval(async () => {
          try {
            const sr = await apiFetch('/api/rebuild/status')
            const s = await sr.json()
            if (s.status === 'done' || s.status === 'error') {
              clearInterval(syncPollRef.current!)
              setSyncing(false)
              setSyncMsg(s.status === 'done' ? 'Profile updated' : 'Sync failed — try again')
              if (s.status === 'done') load()
            }
          } catch { /* keep polling */ }
        }, 3000)
      } else {
        setSyncing(false)
        setSyncMsg('Already up to date')
        load()
      }
    } catch {
      setSyncing(false)
      setSyncMsg('Sync failed — try again')
    }
  }

  const handleLogout = async () => {
    await logout()
    router.replace('/login')
  }

  if (loading) return <ProfileSkeleton />

  if (rebuildInProgress) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ProfileBuilding
          currentUsername={currentUsername}
          onComplete={() => { setRebuildInProgress(false); load() }}
          onError={() => setRebuildInProgress(false)}
        />
      </SafeAreaView>
    )
  }

  if (!profile || !examples) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.errWrap}>
          <Text style={s.errText}>Couldn't load profile</Text>
          <TouchableOpacity onPress={load} style={s.retryBtn} activeOpacity={0.8}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const topGenres = profile.genres.slice(0, 8)
  const maxGenreW = topGenres[0]?.weight ?? 0.01

  const a = profile.critic_alignment
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
    ? 'Your ratings closely match critics'
    : `~${stars.toFixed(1)}★ ${a > 0 ? 'above' : 'below'} critics avg`

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* AI summary sheet */}
        <Modal visible={summaryVisible} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
          <Animated.View style={[StyleSheet.absoluteFill, s.sheetOverlayBg, { opacity: overlayAnim }]} />
          <View style={s.sheetContainer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
            <Animated.View style={[s.sheet, { transform: [{ translateY: sheetAnim }] }]} {...panResponder.panHandlers}>
              <View style={s.dragHandle} />
              <View style={s.sheetHeader}>
                <Sparkles size={15} color={Colors.brand} />
                <Text style={s.sheetTitle}>Your taste</Text>
              </View>
              <Text style={s.sheetBody}>{profile.ai_summary}</Text>
            </Animated.View>
          </View>
        </Modal>

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.heading}>Your taste profile</Text>
            <Text style={s.subheading}>Built from {profile.ratings_count} ratings</Text>
          </View>
          {needsUsername ? (
            <TouchableOpacity
              style={s.connectHeaderBtn}
              onPress={() => router.push('/profile/letterboxd' as any)}
              activeOpacity={0.8}
            >
              <Link2 size={14} color={Colors.brand} />
              <Text style={s.connectHeaderText}>Connect Letterboxd</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.headerActions}>
              <TouchableOpacity onPress={handleShare} disabled={sharing || !profile} activeOpacity={0.7} style={s.syncIcon}>
                <Share2 size={18} color={sharing || !profile ? Colors.textFaint : Colors.brand} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSync} disabled={syncing} activeOpacity={0.7} style={s.syncIcon}>
                {syncing
                  ? <ActivityIndicator size="small" color={Colors.brand} />
                  : <RefreshCw size={20} color={Colors.brand} />
                }
              </TouchableOpacity>
            </View>
          )}
        </View>

        {!!syncMsg && <Text style={s.syncMsg}>{syncMsg}</Text>}

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

        {/* Taste summary trigger */}
        {!!profile.ai_summary && (
          <TouchableOpacity style={s.summaryTrigger} onPress={openSheet} activeOpacity={0.7}>
            <Sparkles size={13} color={Colors.brand} />
            <Text style={s.summaryTriggerText}>About your taste</Text>
            <ChevronRight size={14} color={Colors.textFaint} />
          </TouchableOpacity>
        )}

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
          <InsightCard label="Critic alignment" value={alignLabel} sub={alignDesc} />
          <View style={s.insightPair}>
            <InsightCard label="Quality floor" value={profile.quality_floor.toFixed(1)} sub="Min IMDb for candidates" style={{ flex: 1 }} />
            <InsightCard label="Your neutral" value={`${profile.neutral.toFixed(1)}★`} sub="Calibrated from ratings" brandValue style={{ flex: 1 }} />
          </View>
        </View>

        {/* Favorites */}
        {profile.favorites.length > 0 && (
          <View style={s.section}>
            <SectionLabel>Your favorites <Text style={{ color: Colors.brand }}>★★★★★</Text></SectionLabel>
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

        {/* Account */}
        <View style={s.account}>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
            <LogOut size={15} color={Colors.textMuted} />
            <Text style={s.logoutText}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.supportBtn} onPress={() => router.push('/profile/support')} activeOpacity={0.7}>
            <HelpCircle size={14} color={Colors.textFaint} />
            <Text style={s.supportText}>Support</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Off-screen card for share capture */}
      <View
        ref={storyCardRef}
        collapsable={false}
        style={{ position: 'absolute', left: -(CARD_W + 10), top: 0 }}
      >
        {profile && currentUsername && (
          <StoryCard
            username={currentUsername}
            genres={profile.genres}
            ratingsCount={profile.ratings_count}
            avgRating={profile.avg_rating}
            criticAlignment={profile.critic_alignment}
          />
        )}
      </View>

    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: 28, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: { fontSize: 24, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  subheading: { fontSize: 13, color: Colors.textMuted, marginTop: 3 },
  summaryTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14,
  },
  summaryTriggerText: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
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
  sheetBody: { fontSize: 16, fontStyle: 'italic', color: Colors.textSecondary, lineHeight: 26 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  syncIcon: { padding: 4 },
  connectHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: Colors.brand, borderRadius: 10,
    paddingVertical: 6, paddingHorizontal: 10,
  },
  connectHeaderText: { fontSize: 12, fontWeight: '600', color: Colors.brand },
  syncMsg: { fontSize: 13, color: Colors.textSecondary, marginTop: -18 },
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
  account: { gap: 4, marginTop: 4 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  logoutText: { fontSize: 15, color: Colors.textMuted },
  supportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10 },
  supportText: { fontSize: 13, color: Colors.textFaint },
  badgeStars: { fontSize: 11, color: Colors.brand },
  badgeWatched: { fontSize: 10, color: '#4ade80' },
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errText: { fontSize: 16, color: Colors.textMuted },
  retryBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryText: { fontSize: 14, color: Colors.textSecondary },
})
