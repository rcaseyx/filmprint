import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TextInput, Pressable, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated, Easing, Dimensions, Keyboard, PanResponder,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { FilmCard } from '@/components/FilmCard'
import { Image } from 'expo-image'
import { Coffee, Moon, Sparkles, Flame, Popcorn, Drama, Zap, Film, Hourglass, Check } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tone = 'light' | 'dark'
type Pacing = 'slow' | 'fast'
type Familiarity = 'familiar' | 'challenging'
type RuntimeOption = 90 | 120 | null
type ScreenView = 'selector' | 'loading' | 'results'

interface Genre { name: string; count: number; weight: number }
interface LoaderFilm { id: number; title: string; poster_path: string | null; rating: number }
interface Pick {
  id: number; title: string; year: number | string; source: 'watchlist' | 'discovered'
  score: number; match_pct?: number; reason: string; poster_path: string | null
  genres: string[]; runtime: number | null
  streaming: { name: string; logo_path: string }[]
  scores: { imdb: string | null; rt: string | null; metacritic: string | null }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width
const NUM_STEPS = 3
const GENRE_BTN_W = (SCREEN_W - Spacing.lg * 2 - 10) / 2

const QUADRANTS = [
  { label: 'Cozy',    sub: 'feel-good & easygoing',      Icon: Coffee,   tone: 'light' as Tone, pacing: 'slow' as Pacing, color: '#F59E0B', bg: 'rgba(245,158,11,0.07)',  bgActive: 'rgba(245,158,11,0.18)' },
  { label: 'Moody',   sub: 'atmospheric & introspective', Icon: Moon,     tone: 'dark'  as Tone, pacing: 'slow' as Pacing, color: '#818CF8', bg: 'rgba(129,140,248,0.05)', bgActive: 'rgba(129,140,248,0.18)' },
  { label: 'Playful', sub: 'fun & lighthearted',          Icon: Sparkles, tone: 'light' as Tone, pacing: 'fast' as Pacing, color: '#34D399', bg: 'rgba(52,211,153,0.05)',  bgActive: 'rgba(52,211,153,0.16)'  },
  { label: 'Intense', sub: 'gripping & high-stakes',      Icon: Flame,    tone: 'dark'  as Tone, pacing: 'fast' as Pacing, color: '#F87171', bg: 'rgba(248,113,113,0.05)', bgActive: 'rgba(248,113,113,0.16)' },
]

const FAMILIARITY_OPTIONS = [
  { label: 'Crowd-pleaser', sub: 'mainstream & accessible', value: 'familiar'   as Familiarity },
  { label: 'Challenging',   sub: 'bold & unconventional',   value: 'challenging' as Familiarity },
]

const RUNTIME_OPTIONS: { label: string; sub: string; value: RuntimeOption }[] = [
  { label: 'Short',    sub: '< 90 min',   value: 90   },
  { label: 'Standard', sub: '90–120 min', value: 120  },
  { label: 'Long',     sub: '2+ hours',   value: null },
]

// ── Step dots ─────────────────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  return (
    <View style={sd.row}>
      {Array.from({ length: NUM_STEPS }).map((_, i) => (
        <View key={i} style={[sd.dot, i === step && sd.dotActive]} />
      ))}
    </View>
  )
}

const sd = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { width: 24, backgroundColor: Colors.brand },
})

// ── Quadrant card ─────────────────────────────────────────────────────────────

function QuadrantCard({ q, selected, onPress }: {
  q: typeof QUADRANTS[0]; selected: boolean; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current

  const pressIn  = () => Animated.spring(scale, { toValue: 0.94, tension: 300, friction: 10, useNativeDriver: true }).start()
  const pressOut = () => Animated.spring(scale, { toValue: 1,    tension: 200, friction: 12, useNativeDriver: true }).start()

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={qc.pressable}>
      <Animated.View style={[
        qc.card,
        { backgroundColor: selected ? q.bgActive : q.bg, borderColor: selected ? q.color : Colors.border },
        { transform: [{ scale }] },
      ]}>
        <q.Icon size={30} color={selected ? q.color : Colors.textMuted} strokeWidth={1.5} />
        <Text style={[qc.label, { color: selected ? q.color : Colors.text }]}>{q.label}</Text>
        <Text style={[qc.sub, { color: selected ? q.color + 'BB' : Colors.textMuted }]}>{q.sub}</Text>
      </Animated.View>
    </Pressable>
  )
}

const qc = StyleSheet.create({
  pressable: { flex: 1 },
  card: {
    flex: 1, borderRadius: 20, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md, gap: 6,
  },
  label: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
})

// ── Genre button ──────────────────────────────────────────────────────────────

function GenreButton({ name, selected, onPress }: { name: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[gb.btn, selected && gb.btnActive]} activeOpacity={0.7} onPress={onPress}>
      <Text style={[gb.label, selected && gb.labelActive]}>{name}</Text>
    </TouchableOpacity>
  )
}

const gb = StyleSheet.create({
  btn: {
    width: GENRE_BTN_W, paddingVertical: 17, alignItems: 'center',
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  btnActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  label: { fontSize: 15, fontWeight: '500', color: Colors.textSecondary },
  labelActive: { color: '#0a0a0a', fontWeight: '700' },
})

// ── Step 0: Mood ──────────────────────────────────────────────────────────────

function MoodStep({ tone, pacing, onToggle }: {
  tone: Tone | null; pacing: Pacing | null
  onToggle: (t: Tone | null, p: Pacing | null) => void
}) {
  return (
    <View style={ms.wrap}>
      <View style={ms.header}>
        <Text style={ms.heading}>What kind of night{'\n'}is it?</Text>
        <Text style={ms.sub}>Tap your vibe — or just hit Next.</Text>
      </View>
      <View style={ms.grid}>
        <View style={ms.row}>
          {QUADRANTS.slice(0, 2).map(q => (
            <QuadrantCard
              key={q.label} q={q}
              selected={tone === q.tone && pacing === q.pacing}
              onPress={() => {
                if (tone === q.tone && pacing === q.pacing) onToggle(null, null)
                else onToggle(q.tone, q.pacing)
              }}
            />
          ))}
        </View>
        <View style={ms.row}>
          {QUADRANTS.slice(2).map(q => (
            <QuadrantCard
              key={q.label} q={q}
              selected={tone === q.tone && pacing === q.pacing}
              onPress={() => {
                if (tone === q.tone && pacing === q.pacing) onToggle(null, null)
                else onToggle(q.tone, q.pacing)
              }}
            />
          ))}
        </View>
      </View>
    </View>
  )
}

const ms = StyleSheet.create({
  wrap: { flex: 1, padding: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.md },
  header: { gap: 6 },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.text, lineHeight: 32 },
  sub: { fontSize: 14, color: Colors.textMuted },
  grid: { flex: 1, gap: 10 },
  row: { flex: 1, flexDirection: 'row', gap: 10 },
})

// ── Step 1: Genres ────────────────────────────────────────────────────────────

function GenreStep({ genres, selected, onToggle }: {
  genres: Genre[]; selected: string[]; onToggle: (name: string) => void
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={gs.header}>
        <Text style={gs.heading}>Any genres{'\n'}in mind?</Text>
        <Text style={gs.sub}>Pick as many as you like, or none at all.</Text>
      </View>
      <ScrollView
        contentContainerStyle={gs.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {genres.length === 0 ? (
          <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />
        ) : (
          <View style={gs.grid}>
            {genres.map(g => (
              <GenreButton key={g.name} name={g.name} selected={selected.includes(g.name)} onPress={() => onToggle(g.name)} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const gs = StyleSheet.create({
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: 6 },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.text, lineHeight: 32 },
  sub: { fontSize: 14, color: Colors.textMuted },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
})

// ── Option card (shared by Vibe + Length) ─────────────────────────────────────

function OptionCard({ Icon, label, sub, selected, onPress }: {
  Icon: LucideIcon; label: string; sub: string; selected: boolean; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const pressIn  = () => Animated.spring(scale, { toValue: 0.94, tension: 300, friction: 10, useNativeDriver: true }).start()
  const pressOut = () => Animated.spring(scale, { toValue: 1,    tension: 200, friction: 12, useNativeDriver: true }).start()

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={oc.pressable}>
      <Animated.View style={[oc.card, selected && oc.cardActive, { transform: [{ scale }] }]}>
        <Icon size={26} color={selected ? '#0a0a0a' : Colors.textMuted} strokeWidth={1.5} />
        <Text style={[oc.label, selected && oc.labelActive]}>{label}</Text>
        <Text style={[oc.sub, selected && oc.subActive]}>{sub}</Text>
      </Animated.View>
    </Pressable>
  )
}

const oc = StyleSheet.create({
  pressable: { flex: 1 },
  card: {
    flex: 1, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: Spacing.sm,
  },
  cardActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  label: { fontSize: 16, fontWeight: '700', color: Colors.text },
  labelActive: { color: '#0a0a0a' },
  sub: { fontSize: 12, textAlign: 'center', lineHeight: 16, color: Colors.textMuted },
  subActive: { color: '#1a1a1a' },
})

// ── Step 2: Filters ───────────────────────────────────────────────────────────

function FiltersStep({ familiarity, setFamiliarity, runtime, setRuntime, freeText, setFreeText }: {
  familiarity: Familiarity | null; setFamiliarity: (v: Familiarity | null) => void
  runtime: RuntimeOption | 'any'; setRuntime: (v: RuntimeOption | 'any') => void
  freeText: string; setFreeText: (v: string) => void
}) {
  return (
    <View style={fs.wrap}>
      <View style={fs.header}>
        <Text style={fs.heading}>Anything{'\n'}else?</Text>
        <Text style={fs.sub}>All optional.</Text>
      </View>

      <View style={fs.vibeRow}>
        <OptionCard
          Icon={Popcorn} label="Crowd-pleaser" sub="mainstream & accessible"
          selected={familiarity === 'familiar'}
          onPress={() => setFamiliarity(familiarity === 'familiar' ? null : 'familiar')}
        />
        <OptionCard
          Icon={Drama} label="Challenging" sub="bold & unconventional"
          selected={familiarity === 'challenging'}
          onPress={() => setFamiliarity(familiarity === 'challenging' ? null : 'challenging')}
        />
      </View>

      <View style={fs.lengthRow}>
        <OptionCard Icon={Zap}      label="Short"    sub="< 90 min"   selected={runtime === 90}   onPress={() => setRuntime(runtime === 90   ? 'any' : 90)}   />
        <OptionCard Icon={Film}     label="Standard" sub="90–120 min" selected={runtime === 120}  onPress={() => setRuntime(runtime === 120  ? 'any' : 120)}  />
        <OptionCard Icon={Hourglass} label="Long"    sub="2+ hours"   selected={runtime === null} onPress={() => setRuntime(runtime === null ? 'any' : null)} />
      </View>

      <TextInput
        style={fs.input}
        value={freeText}
        onChangeText={setFreeText}
        placeholder="Anything specific? (set in Japan, a director I haven't seen…)"
        placeholderTextColor={Colors.textFaint}
        multiline
        numberOfLines={2}
      />
    </View>
  )
}

const fs = StyleSheet.create({
  wrap: { flex: 1, padding: Spacing.lg, paddingTop: Spacing.md, gap: 10 },
  header: { gap: 6 },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.text, lineHeight: 32 },
  sub: { fontSize: 14, color: Colors.textMuted },
  vibeRow: { flex: 3, flexDirection: 'row', gap: 10 },
  lengthRow: { flex: 2, flexDirection: 'row', gap: 10 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: 14, color: Colors.text,
    textAlignVertical: 'top', minHeight: 68,
  },
})

// ── Loader ────────────────────────────────────────────────────────────────────

const LOADER_STEPS = [
  'Reading your taste profile',
  'Scanning your watchlist',
  'Finding candidates',
  'Composing your picks',
]
const STEP_DELAYS_MS = [5000, 11000, 17000]
const POSTER_W = Math.floor((SCREEN_W - Spacing.lg * 2 - 12) / 2)
const POSTER_H = Math.floor(POSTER_W * 1.5)
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342'

function pickPosters(examples: Record<string, LoaderFilm[]>, selectedGenres: string[], count = 8): LoaderFilm[] {
  const seen = new Set<number>()
  const result: LoaderFilm[] = []
  const preferred = selectedGenres.flatMap(g => examples[g] || []).sort(() => Math.random() - 0.5)
  for (const f of preferred) {
    if (!seen.has(f.id) && result.length < count) { seen.add(f.id); result.push(f) }
  }
  if (result.length < count) {
    const all = Object.values(examples).flat().sort(() => Math.random() - 0.5)
    for (const f of all) {
      if (!seen.has(f.id) && result.length < count) { seen.add(f.id); result.push(f) }
    }
  }
  return result
}

// Renders a single poster slot — expo-image crossfades automatically when source changes.
// Stars re-animate on each film change via the film.id dependency.
function CyclingPoster({ film }: { film: LoaderFilm }) {
  const starsOpacity = useRef(new Animated.Value(0)).current
  const starsY       = useRef(new Animated.Value(10)).current

  useEffect(() => {
    starsOpacity.setValue(0)
    starsY.setValue(10)
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(starsOpacity, { toValue: 1, duration: 380, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(starsY,       { toValue: 0, duration: 380, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start()
    }, 250)
    return () => clearTimeout(t)
  }, [film.id])

  return (
    <View style={lp.slot}>
      <Image
        source={film.poster_path ? { uri: `${TMDB_IMG}${film.poster_path}` } : undefined}
        style={lp.img}
        contentFit="cover"
        transition={600}
      />
      <View style={lp.overlay}>
        <Animated.View style={{ opacity: starsOpacity, transform: [{ translateY: starsY }] }}>
          <Text style={lp.stars}>{'★'.repeat(Math.floor(film.rating))}{film.rating % 1 >= 0.5 ? '½' : ''}</Text>
        </Animated.View>
      </View>
    </View>
  )
}

const lp = StyleSheet.create({
  slot: { width: POSTER_W, height: POSTER_H, borderRadius: 14, overflow: 'hidden', backgroundColor: Colors.card },
  img: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  stars: { color: Colors.brand, fontSize: 20, letterSpacing: 4 },
})

function PicksLoader({ genreExamples, selectedGenres }: {
  genreExamples: Record<string, LoaderFilm[]>
  selectedGenres: string[]
}) {
  const [posters]  = useState(() => pickPosters(genreExamples, selectedGenres))
  const [indices, setIndices] = useState([0, Math.min(1, posters.length - 1)])
  const [step, setStep]     = useState(0)
  const [dotCount, setDotCount] = useState(1)
  const pulseAnim  = useRef(new Animated.Value(1)).current
  const cycleSlot  = useRef(0)
  const nextFilm   = useRef(2)

  useEffect(() => {
    const timers = STEP_DELAYS_MS.map((delay, i) => setTimeout(() => setStep(i + 1), delay))
    const dotInterval = setInterval(() => setDotCount(n => (n % 3) + 1), 500)

    // Cycle one poster every 3.5s, alternating slots
    let cycleInterval: ReturnType<typeof setInterval> | undefined
    if (posters.length > 2) {
      cycleInterval = setInterval(() => {
        const slot = cycleSlot.current
        const film = nextFilm.current % posters.length
        setIndices(prev => { const n = [...prev]; n[slot] = film; return n })
        nextFilm.current++
        cycleSlot.current = 1 - slot
      }, 3500)
    }

    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
    ]))
    pulse.start()

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(dotInterval)
      if (cycleInterval) clearInterval(cycleInterval)
      pulse.stop()
    }
  }, [posters.length])

  return (
    <View style={lo.wrap}>
      {posters.length > 0 && (
        <View style={lo.postersSection}>
          <View style={lo.postersRow}>
            <CyclingPoster film={posters[indices[0]]} />
            {posters.length > 1 && <CyclingPoster film={posters[indices[1]]} />}
          </View>
          <Text style={lo.postersLabel}>Starting from your favorites</Text>
        </View>
      )}

      <View style={lo.steps}>
        {LOADER_STEPS.map((label, i) => {
          const done   = i < step
          const active = i === step
          return (
            <View key={label} style={[lo.stepRow, i > step && lo.stepFaint]}>
              <View style={lo.stepIcon}>
                {done
                  ? <Check size={15} color={Colors.brand} strokeWidth={2.5} />
                  : active
                    ? <Animated.View style={[lo.activeDot, { opacity: pulseAnim }]} />
                    : <View style={lo.pendingDot} />
                }
              </View>
              <Text style={[lo.stepText, done && lo.stepDone, active && lo.stepActive]}>
                {active ? `${label}${'.'.repeat(dotCount)}` : label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const lo = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 44, paddingHorizontal: Spacing.lg },
  postersSection: { alignItems: 'center', gap: 16 },
  postersRow: { flexDirection: 'row', gap: 12 },
  postersLabel: { fontSize: 12, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },
  steps: { gap: 16, alignSelf: 'stretch', paddingHorizontal: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepFaint: { opacity: 0.22 },
  stepIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand },
  pendingDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: Colors.border },
  stepText: { fontSize: 15, color: Colors.textMuted, flex: 1 },
  stepDone: { color: Colors.textFaint },
  stepActive: { color: Colors.text, fontWeight: '500' },
})

// ── Main screen ───────────────────────────────────────────────────────────────

export default function PicksScreen() {
  const router = useRouter()
  const { logout } = useAuth()
  const { bottom: bottomInset } = useSafeAreaInsets()
  const [checking, setChecking] = useState(true)

  const initialFocus = useRef(true)

  const [step, setStep] = useState(0)
  const stepRef = useRef(0)
  const slideAnim = useRef(new Animated.Value(0)).current

  const [genres, setGenres] = useState<Genre[]>([])
  const [genreExamples, setGenreExamples] = useState<Record<string, LoaderFilm[]>>({})
  const [tone, setTone] = useState<Tone | null>(null)
  const [pacing, setPacing] = useState<Pacing | null>(null)
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [familiarity, setFamiliarity] = useState<Familiarity | null>(null)
  const [runtime, setRuntime] = useState<RuntimeOption | 'any'>('any')
  const [freeText, setFreeText] = useState('')

  const [screenView, setScreenView] = useState<ScreenView>('selector')
  const [picks, setPicks] = useState<Pick[]>([])
  const [error, setError] = useState<string | null>(null)
  const resultsScrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    apiFetch('/api/user')
      .then(async r => {
        if (r.status === 401) { await logout(); router.replace('/login'); return }
        const data = await r.json()
        if (!data.has_profile) { router.replace('/onboarding'); return }
        Promise.all([
          apiFetch('/api/genres').then(r => r.json()),
          apiFetch('/api/profile/examples').then(r => r.json()),
        ]).then(([gd, ex]) => {
          setGenres(gd.genres ?? [])
          setGenreExamples(ex.genre ?? {})
        }).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  const goToStep = (next: number) => {
    Keyboard.dismiss()
    stepRef.current = next
    setStep(next)
    Animated.spring(slideAnim, {
      toValue: -next * SCREEN_W,
      tension: 80, friction: 14,
      useNativeDriver: true,
    }).start()
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 10,
      onPanResponderGrant: () => {
        slideAnim.stopAnimation()
        slideAnim.setOffset(-stepRef.current * SCREEN_W)
        slideAnim.setValue(0)
      },
      onPanResponderMove: (_, gs) => {
        const s = stepRef.current
        let dx = gs.dx
        if ((s === 0 && dx > 0) || (s === NUM_STEPS - 1 && dx < 0)) dx *= 0.15
        slideAnim.setValue(dx)
      },
      onPanResponderRelease: (_, gs) => {
        slideAnim.flattenOffset()
        const s = stepRef.current
        const DIST = SCREEN_W * 0.25
        const VEL  = 0.4
        if ((gs.dx < -DIST || gs.vx < -VEL) && s < NUM_STEPS - 1) {
          goToStep(s + 1)
        } else if ((gs.dx > DIST || gs.vx > VEL) && s > 0) {
          goToStep(s - 1)
        } else {
          Animated.spring(slideAnim, { toValue: -s * SCREEN_W, tension: 120, friction: 14, useNativeDriver: true }).start()
        }
      },
      onPanResponderTerminate: () => {
        slideAnim.flattenOffset()
        Animated.spring(slideAnim, { toValue: -stepRef.current * SCREEN_W, tension: 120, friction: 14, useNativeDriver: true }).start()
      },
    })
  ).current

  const toggleGenre = (name: string) =>
    setSelectedGenres(prev => prev.includes(name) ? prev.filter(g => g !== name) : [...prev, name])

  const fetchPicks = async () => {
    Keyboard.dismiss()
    setScreenView('loading')
    setError(null)
    try {
      const res = await apiFetch('/api/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          required_genres: selectedGenres,
          exclude_genres: [],
          max_runtime: runtime === 'any' ? null : runtime,
          tone, pacing, familiarity,
          free_text: freeText.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).detail || 'API error')
      }
      const data = await res.json()
      setPicks(data.picks ?? [])
      setScreenView('results')
      setTimeout(() => resultsScrollRef.current?.scrollTo({ y: 0, animated: false }), 50)
    } catch (e: any) {
      setError(e.message || 'Something went wrong — try again.')
      setScreenView('selector')
    }
  }

  const handleReset = useCallback(() => {
    setTone(null); setPacing(null)
    setSelectedGenres([])
    setFamiliarity(null); setRuntime('any'); setFreeText('')
    setError(null); setPicks([])
    setStep(0); stepRef.current = 0
    slideAnim.setValue(0)
    setScreenView('selector')
  }, [])

  useFocusEffect(useCallback(() => {
    if (initialFocus.current) { initialFocus.current = false; return }
    handleReset()
  }, [handleReset]))

  // ── Auth check ──────────────────────────────────────────────────────────────
  if (checking) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={Colors.brand} /></View>
      </SafeAreaView>
    )
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (screenView === 'loading') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <PicksLoader genreExamples={genreExamples} selectedGenres={selectedGenres} />
      </SafeAreaView>
    )
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  if (screenView === 'results') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView
          ref={resultsScrollRef}
          contentContainerStyle={s.resultsScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.resultsHeading}>Your picks</Text>
          <View style={s.stack}>
            {picks.map(pick => <FilmCard key={pick.id} pick={pick} />)}
          </View>
          <View style={s.resultActions}>
            <TouchableOpacity style={s.btnPrimary} activeOpacity={0.8} onPress={fetchPicks}>
              <Text style={s.btnPrimaryText}>Show me different picks</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} activeOpacity={0.8} onPress={handleReset}>
              <Text style={s.btnSecondaryText}>Start over</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Selector ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Top nav */}
      <View style={s.topBar}>
        <TouchableOpacity
          style={s.navBtn}
          onPress={() => goToStep(step - 1)}
          disabled={step === 0}
          hitSlop={12}
        >
          {step > 0 && <Text style={s.backText}>←</Text>}
        </TouchableOpacity>
        <StepDots step={step} />
        <View style={s.navBtn} />
      </View>

      {/* Slide tape */}
      <View style={s.tape} {...panResponder.panHandlers}>
        <Animated.View
          style={[s.tapeInner, { transform: [{ translateX: slideAnim }] }]}
          renderToHardwareTextureAndroid
        >
          <View style={s.slide} pointerEvents={step === 0 ? 'auto' : 'none'}>
            <MoodStep
              tone={tone} pacing={pacing}
              onToggle={(t, p) => { setTone(t); setPacing(p) }}
            />
          </View>
          <View style={s.slide} pointerEvents={step === 1 ? 'auto' : 'none'}>
            <GenreStep genres={genres} selected={selectedGenres} onToggle={toggleGenre} />
          </View>
          <View style={s.slide} pointerEvents={step === 2 ? 'auto' : 'none'}>
            <FiltersStep
              familiarity={familiarity} setFamiliarity={setFamiliarity}
              runtime={runtime} setRuntime={setRuntime}
              freeText={freeText} setFreeText={setFreeText}
            />
          </View>
        </Animated.View>
      </View>

      {/* Bottom actions */}
      <View style={[s.bottom, { paddingBottom: bottomInset + Spacing.lg }]}>
        {error && <Text style={s.error}>{error}</Text>}
        {step === 0 && (
          <TouchableOpacity style={s.btnPrimary} activeOpacity={0.85} onPress={() => goToStep(1)}>
            <Text style={s.btnPrimaryText}>Next  →</Text>
          </TouchableOpacity>
        )}
        {step === 1 && (
          <TouchableOpacity style={s.btnPrimary} activeOpacity={0.85} onPress={() => goToStep(2)}>
            <Text style={s.btnPrimaryText}>Next  →</Text>
          </TouchableOpacity>
        )}
        {step === 2 && (
          <TouchableOpacity style={s.btnPrimary} activeOpacity={0.85} onPress={fetchPicks}>
            <Text style={s.btnPrimaryText}>Find my picks</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 6,
  },
  navBtn: { width: 44, height: 44, justifyContent: 'center' },
  backText: { fontSize: 22, color: Colors.textSecondary },

  tape: { flex: 1, overflow: 'hidden' },
  tapeInner: { flex: 1, flexDirection: 'row', width: SCREEN_W * NUM_STEPS },
  slide: { width: SCREEN_W },

  bottom: {
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: 10,
  },
  error: { fontSize: 13, color: Colors.error },
  btnPrimary: { backgroundColor: Colors.brand, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#0a0a0a' },
  btnSecondary: {
    borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 17, alignItems: 'center',
  },
  btnSecondaryText: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  resultsScroll: { padding: Spacing.lg, paddingBottom: 100, gap: Spacing.md },
  resultsHeading: { fontSize: 24, fontWeight: '800', color: Colors.text },
  stack: { gap: Spacing.md },
  resultActions: { gap: 10, marginTop: 4 },
})
