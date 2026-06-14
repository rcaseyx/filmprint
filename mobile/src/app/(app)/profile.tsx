import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity,
  ActivityIndicator, StyleSheet, Modal, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import Svg, { Circle, Line, Polygon, Text as SvgText, TSpan, G } from 'react-native-svg'
import { RefreshCw, LogOut, Link2 } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const TMDB = 'https://image.tmdb.org/t/p/w342'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Axis { name: string; weight: number; count?: number; shortName?: string }

interface Example {
  id: number; title: string; year: number | null
  rating: number; poster_path: string | null
}

type RadarExamples = Record<string, Example[]>

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

function splitLabel(text: string, maxLen = 10): [string, string | null] {
  if (text.length <= maxLen) return [text, null]
  let pivot = text.lastIndexOf(' ', maxLen)
  if (pivot <= 0) pivot = text.indexOf(' ')
  if (pivot > 0) return [text.slice(0, pivot), text.slice(pivot + 1)]
  return [text, null]  // single long word — keep on one line
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 30) return `${diff}d ago`
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`
  return `${Math.floor(diff / 365)}y ago`
}

// ─── SVG Radar ────────────────────────────────────────────────────────────────

const SIZE = 220, CENTER = SIZE / 2, RADIUS = SIZE * 0.42, LABEL_R = RADIUS + 34, PAD = 46
const VBOX_SIZE = SIZE + PAD * 2
const SCREEN_W = Dimensions.get('window').width
const SCREEN_H = Dimensions.get('window').height
const TOOLTIP_W = 212

function RNRadar({
  data,
  selected,
  onDotPress,
}: {
  data: Axis[]
  selected: number | null
  onDotPress: (i: number, svgX: number, svgY: number) => void
}) {
  const top = data.slice(0, 8)
  const N = top.length
  if (N < 3) return null

  const maxW = Math.max(...top.map(d => Math.abs(d.weight)), 0.01)
  const angles = top.map((_, i) => (i / N) * 2 * Math.PI - Math.PI / 2)
  const pts = top.map((d, i) => {
    const r = Math.max(0, (d.weight / maxW) * RADIUS)
    return { x: CENTER + r * Math.cos(angles[i]), y: CENTER + r * Math.sin(angles[i]) }
  })
  const polygon = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const vbSize = SIZE + PAD * 2

  return (
    <View style={{ width: '100%', aspectRatio: 1 }}>
      <Svg viewBox={`${-PAD} ${-PAD} ${vbSize} ${vbSize}`} width="100%" height="100%">
        {/* Rings */}
        {[0.25, 0.5, 0.75, 1.0].map(r => (
          <Circle key={r} cx={CENTER} cy={CENTER} r={r * RADIUS}
            fill="none" stroke={Colors.border} strokeWidth={1} />
        ))}
        {/* Spokes */}
        {angles.map((a, i) => (
          <Line key={i} x1={CENTER} y1={CENTER}
            x2={CENTER + RADIUS * Math.cos(a)} y2={CENTER + RADIUS * Math.sin(a)}
            stroke={Colors.border} strokeWidth={1} />
        ))}
        {/* Polygon */}
        <Polygon points={polygon}
          fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.9)"
          strokeWidth={2} strokeLinejoin="round" />
        {/* Dots */}
        {pts.map((p, i) => (
          <G key={i} onPress={() => onDotPress(i, p.x, p.y)}>
            <Circle cx={p.x} cy={p.y} r={16} fill="transparent" />
            <Circle cx={p.x} cy={p.y} r={6}
              fill={selected === i ? 'rgba(251,191,36,0.45)' : 'rgba(251,191,36,0.18)'} />
            <Circle cx={p.x} cy={p.y} r={selected === i ? 4 : 3} fill="#fbbf24" />
          </G>
        ))}
        {/* Labels */}
        {top.map((d, i) => {
          const lx = CENTER + LABEL_R * Math.cos(angles[i])
          const ly = CENTER + LABEL_R * Math.sin(angles[i])
          const [l1, l2] = splitLabel(d.shortName ?? d.name)
          const fill = selected === i ? '#a3a3a3' : '#737373'
          return (
            <SvgText key={d.name} textAnchor="middle" fontSize={9} fill={fill}>
              {l2 ? (
                <>
                  <TSpan x={lx} y={ly} dy={-6}>{l1}</TSpan>
                  <TSpan x={lx} dy={13}>{l2}</TSpan>
                </>
              ) : (
                <TSpan x={lx} y={ly}>{l1}</TSpan>
              )}
            </SvgText>
          )
        })}
      </Svg>
    </View>
  )
}

// ─── Tooltip (Modal-based, renders above everything) ─────────────────────────

function TooltipCard({
  point, examples, pos, maxWeight,
}: {
  point: Axis; examples: Example[]
  pos: { x: number; y: number }; maxWeight: number
}) {
  const left = Math.max(12, Math.min(SCREEN_W - TOOLTIP_W - 12, pos.x - TOOLTIP_W / 2))
  const showBelow = pos.y < SCREEN_H * 0.58
  const top = showBelow ? pos.y + 18 : pos.y - 200

  return (
    <View style={[tt.card, { top, left }]}>
      <Text style={tt.name}>{point.name}</Text>
      <Text style={tt.pct}>
        {Math.round((point.weight / maxWeight) * 100)}% affinity
        {point.count ? ` · ${point.count} films` : ''}
      </Text>
      {examples.length > 0 && (
        <>
          <View style={tt.divider} />
          <View style={tt.posters}>
            {examples.map(ex => (
              <TouchableOpacity
                key={ex.id}
                onPress={() => WebBrowser.openBrowserAsync(`https://letterboxd.com/tmdb/${ex.id}/`)}
                activeOpacity={0.8}
                style={tt.posterItem}
              >
                <View style={tt.posterWrap}>
                  {ex.poster_path && (
                    <Image source={{ uri: `${TMDB}${ex.poster_path}` }} style={tt.posterImg} contentFit="cover" transition={150} />
                  )}
                </View>
                <Text style={tt.posterTitle} numberOfLines={2}>{ex.title}</Text>
                <Text style={tt.posterRating}>★{ex.rating}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const tt = StyleSheet.create({
  card: {
    position: 'absolute', width: TOOLTIP_W,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, gap: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.7, shadowRadius: 16, elevation: 16,
  },
  name: { fontSize: 14, fontWeight: '600', color: Colors.text },
  pct: { fontSize: 12, color: Colors.textMuted },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 8 },
  posters: { flexDirection: 'row', gap: 8 },
  posterItem: { width: 56, gap: 3 },
  posterWrap: { width: 56, height: 84, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.border },
  posterImg: { width: '100%', height: '100%' },
  posterTitle: { fontSize: 9, color: Colors.textSecondary, lineHeight: 13 },
  posterRating: { fontSize: 9, color: Colors.brand },
})

// ─── Radar Section (tabbed) ───────────────────────────────────────────────────

type RadarTab = 'Genre' | 'Themes' | 'Era' | 'Tone'
const RADAR_TABS: RadarTab[] = ['Genre', 'Themes', 'Era', 'Tone']

function RadarSection({
  genres, subgenres, decades, tone,
  examples,
}: {
  genres: Axis[]; subgenres: Axis[]; decades: Axis[]; tone: Axis[]
  examples: { genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples }
}) {
  const [active, setActive] = useState<RadarTab>('Genre')
  const [selected, setSelected] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const radarRef = useRef<View>(null)

  const datasets: Record<RadarTab, Axis[]> = {
    Genre: genres.slice(0, 8),
    Themes: subgenres,
    Era: decades,
    Tone: tone,
  }
  const exMap: Record<RadarTab, RadarExamples> = {
    Genre: examples.genre,
    Themes: examples.subgenre,
    Era: examples.era,
    Tone: examples.tone,
  }

  const currentData = datasets[active]
  const maxW = Math.max(...currentData.map(d => d.weight), 0.01)
  const selectedPoint = selected !== null ? currentData[selected] : null
  const selectedExamples = selectedPoint ? (exMap[active][selectedPoint.name] ?? []) : []

  const handleDotPress = (i: number, svgX: number, svgY: number) => {
    if (selected === i) {
      setSelected(null)
      setTooltipPos(null)
      return
    }
    radarRef.current?.measureInWindow((cx, cy, cw) => {
      const scale = cw / VBOX_SIZE
      setSelected(i)
      setTooltipPos({ x: cx + (svgX + PAD) * scale, y: cy + (svgY + PAD) * scale })
    })
  }

  const dismiss = () => { setSelected(null); setTooltipPos(null) }

  const switchTab = (tab: RadarTab) => { setActive(tab); dismiss() }

  return (
    <View>
      {/* Tabs */}
      <View style={rs.tabRow}>
        {RADAR_TABS.map(tab => (
          <TouchableOpacity key={tab} onPress={() => switchTab(tab)} style={rs.tab} activeOpacity={0.7}>
            <Text style={[rs.tabText, active === tab && rs.tabActive]}>{tab}</Text>
            {active === tab && <View style={rs.tabLine} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Chart */}
      <View ref={radarRef}>
        <RNRadar data={currentData} selected={selected} onDotPress={handleDotPress} />
      </View>

      {/* Tooltip — Modal renders above everything, no z-index issues */}
      <Modal transparent visible={!!selectedPoint && !!tooltipPos} onRequestClose={dismiss}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={dismiss} activeOpacity={1} />
        {selectedPoint && tooltipPos && (
          <TooltipCard point={selectedPoint} examples={selectedExamples} pos={tooltipPos} maxWeight={maxW} />
        )}
      </Modal>
    </View>
  )
}

const rs = StyleSheet.create({
  tabRow: { flexDirection: 'row', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 8 },
  tab: { paddingHorizontal: 16, paddingBottom: 10, alignItems: 'center', position: 'relative' },
  tabText: { fontSize: 14, color: Colors.textMuted },
  tabActive: { color: Colors.text },
  tabLine: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 1, backgroundColor: Colors.brand },
})

// ─── Poster card (favorites + history) ───────────────────────────────────────

function PosterCard({
  id, title, year, poster_path, badge,
}: {
  id: number; title: string; year?: number | null
  poster_path: string | null; badge?: React.ReactNode
}) {
  const open = () => WebBrowser.openBrowserAsync(`https://letterboxd.com/tmdb/${id}/`)
  return (
    <TouchableOpacity onPress={open} activeOpacity={0.82} style={pc.wrap}>
      <View style={pc.imgWrap}>
        {poster_path ? (
          <Image source={{ uri: `${TMDB}${poster_path}` }} style={pc.img} contentFit="cover" transition={200} />
        ) : (
          <View style={[pc.img, pc.noPoster]}>
            <Text style={pc.noPosterText} numberOfLines={3}>{title}</Text>
          </View>
        )}
        {badge && <View style={pc.badge}>{badge}</View>}
      </View>
      <Text style={pc.title} numberOfLines={1}>{title}</Text>
    </TouchableOpacity>
  )
}

const pc = StyleSheet.create({
  wrap: { width: 104, flexShrink: 0 },
  imgWrap: { width: 104, height: 156, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.border, marginBottom: 6 },
  img: { width: '100%', height: '100%' },
  noPoster: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  noPosterText: { fontSize: 10, color: Colors.textFaint, textAlign: 'center' },
  badge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(10,10,10,0.8)', paddingVertical: 4, alignItems: 'center' },
  title: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
})

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ label, value, sub, brandValue, style }: { label: string; value: string; sub: string; brandValue?: boolean; style?: object }) {
  return (
    <View style={[ic.card, style]}>
      <Text style={ic.label}>{label}</Text>
      <Text style={[ic.value, brandValue && { color: Colors.brand }]}>{value}</Text>
      <Text style={ic.sub}>{sub}</Text>
    </View>
  )
}

const ic = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 3 },
  label: { fontSize: 10, fontWeight: '700', color: Colors.textFaint, letterSpacing: 0.8, textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 11, color: Colors.textFaint },
})

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={sl.text}>{children}</Text>
}

const sl = StyleSheet.create({
  text: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
})

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { logout } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [examples, setExamples] = useState<{ genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples } | null>(null)
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

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={Colors.brand} style={{ marginTop: 60 }} />
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

        {/* Insight cards — critic alignment full-width, numbers side by side */}
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
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: 28, paddingBottom: 100 },
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
  account: { gap: 12, marginTop: 4 },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.brand, borderRadius: 14,
    paddingVertical: 14, justifyContent: 'center',
  },
  connectText: { fontSize: 15, fontWeight: '600', color: Colors.brand },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  logoutText: { fontSize: 15, color: Colors.textMuted },
  badgeStars: { fontSize: 11, color: Colors.brand },
  badgeWatched: { fontSize: 10, color: '#4ade80' },
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errText: { fontSize: 16, color: Colors.textMuted },
  retryBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryText: { fontSize: 14, color: Colors.textSecondary },
})
