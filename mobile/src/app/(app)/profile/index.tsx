import { useState, useEffect, useCallback } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { RefreshCw, LogOut, Link2, HelpCircle } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
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
  summary: string | null
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
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [examples, setExamples] = useState<{
    genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples
  } | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [needsUsername, setNeedsUsername] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const [pd, ed, hd, ud] = await Promise.all([
        apiFetch('/api/profile').then(r => r.json()),
        apiFetch('/api/profile/examples').then(r => r.json()),
        apiFetch('/api/recommendations/history').then(r => r.json()),
        apiFetch('/api/user').then(r => r.json()),
      ])
      setProfile(pd)
      setExamples(ed)
      setHistory(hd.history ?? [])
      setNeedsUsername(ud.needs_username)
    } catch {
      // leave null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await apiFetch('/api/sync', { method: 'POST' })
      const data = await r.json()
      const added = data.ratings_added ?? 0
      setSyncMsg(added > 0 ? `+${added} ratings synced` : 'Already up to date')
      load()
    } catch {
      setSyncMsg('Sync failed — try again')
    } finally {
      setSyncing(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    router.replace('/login')
  }

  if (loading) return <ProfileSkeleton />

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

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.heading}>Your taste profile</Text>
            <Text style={s.subheading}>Built from {profile.ratings_count} ratings</Text>
          </View>
          <TouchableOpacity onPress={handleSync} disabled={syncing} activeOpacity={0.7} style={s.syncIcon}>
            {syncing
              ? <ActivityIndicator size="small" color={Colors.brand} />
              : <RefreshCw size={20} color={Colors.brand} />
            }
          </TouchableOpacity>
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
          {needsUsername && (
            <TouchableOpacity
              style={s.connectBtn}
              onPress={() => router.push('/onboarding/letterboxd')}
              activeOpacity={0.8}
            >
              <Link2 size={16} color={Colors.brand} />
              <Text style={s.connectText}>Connect Letterboxd</Text>
            </TouchableOpacity>
          )}
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
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: 28, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: { fontSize: 24, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  subheading: { fontSize: 13, color: Colors.textMuted, marginTop: 3 },
  syncIcon: { padding: 4 },
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
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.brand, borderRadius: 14,
    paddingVertical: 14, justifyContent: 'center', marginBottom: 8,
  },
  connectText: { fontSize: 15, fontWeight: '600', color: Colors.brand },
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
