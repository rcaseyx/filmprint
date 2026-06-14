import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { Colors, Spacing } from '@/constants/theme'

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w500'
const TMDB_LOGO = 'https://image.tmdb.org/t/p/original'

const STREAMING_WHITELIST = new Set([
  'Netflix', 'Amazon Prime Video', 'Disney+', 'Max', 'HBO Max',
  'Hulu', 'Apple TV+', 'Peacock', 'Paramount+', 'Starz',
  'MGM+', 'AMC+', 'Shudder', 'Criterion Channel', 'MUBI', 'Tubi',
])

interface Pick {
  id: number
  title: string
  year: number | string
  source: 'watchlist' | 'discovered'
  score: number
  match_pct?: number
  reason: string
  poster_path: string | null
  genres: string[]
  runtime: number | null
  streaming: { name: string; logo_path: string }[]
  scores: { imdb: string | null; rt: string | null; metacritic: string | null }
}

function ScoreBadge({ label, value, bg, dark }: { label: string; value: string; bg: string; dark?: boolean }) {
  return (
    <View style={sc.chip}>
      <View style={[sc.label, { backgroundColor: bg }]}>
        <Text style={[sc.labelText, dark && { color: '#000' }]}>{label}</Text>
      </View>
      <Text style={sc.value}>{value}</Text>
    </View>
  )
}

const sc = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  labelText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  value: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
})

export function FilmCard({ pick }: { pick: Pick }) {
  const openLetterboxd = () => {
    WebBrowser.openBrowserAsync(`https://letterboxd.com/tmdb/${pick.id}/`)
  }

  const mc = pick.scores.metacritic !== null ? parseInt(pick.scores.metacritic!) : null
  const mcBg = mc !== null
    ? mc >= 61 ? '#54A72A' : mc >= 40 ? '#FFCC34' : '#E32400'
    : undefined
  const mcDark = mc !== null && mc >= 40 && mc < 61

  const streaming = pick.streaming?.filter(p => STREAMING_WHITELIST.has(p.name)).slice(0, 5) ?? []
  const hasScores = !!(pick.scores.rt || pick.scores.imdb || mc !== null)
  const meta = [...pick.genres.slice(0, 3), pick.runtime ? `${pick.runtime}m` : null].filter(Boolean).join(' · ')

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.92} onPress={openLetterboxd}>
      {/* Poster — full width, portrait */}
      <View style={s.posterWrap}>
        {pick.poster_path ? (
          <Image
            source={{ uri: `${TMDB_POSTER}${pick.poster_path}` }}
            style={s.poster}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[s.poster, s.noPoster]}>
            <Text style={s.noPosterText}>No poster</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={s.info}>
        <View>
          <Text style={s.title}>{pick.title}</Text>
          <Text style={s.year}>{pick.year}</Text>
        </View>

        <View style={s.badgeRow}>
          <View style={[s.badge, pick.source === 'watchlist' ? s.badgeWl : s.badgeDisc]}>
            <Text style={[s.badgeText, pick.source === 'watchlist' ? s.badgeTextBrand : s.badgeTextMuted]}>
              {pick.source === 'watchlist' ? 'On your watchlist' : 'New discovery'}
            </Text>
          </View>
          {pick.match_pct != null && (
            <Text style={s.match}>{pick.match_pct}% match</Text>
          )}
        </View>

        {!!meta && <Text style={s.meta} numberOfLines={1}>{meta}</Text>}

        {hasScores && (
          <View style={s.scores}>
            {pick.scores.rt   && <ScoreBadge label="RT"   value={pick.scores.rt}   bg="#FA320A" />}
            {pick.scores.imdb && <ScoreBadge label="IMDb" value={pick.scores.imdb} bg="#F5C518" dark />}
            {mc !== null      && <ScoreBadge label="MC"   value={String(mc)}        bg={mcBg!}  dark={mcDark} />}
          </View>
        )}

        <Text style={s.reason}>{pick.reason}</Text>

        {streaming.length > 0 && (
          <View style={s.streaming}>
            {streaming.map(p => (
              <Image
                key={p.logo_path}
                source={{ uri: `${TMDB_LOGO}${p.logo_path}` }}
                style={s.streamLogo}
                contentFit="cover"
              />
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  posterWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: Colors.border,
  },
  poster: { width: '100%', height: '100%' },
  noPoster: { alignItems: 'center', justifyContent: 'center' },
  noPosterText: { color: Colors.textFaint, fontSize: 13 },
  info: {
    padding: Spacing.md,
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text, lineHeight: 28 },
  year: { fontSize: 15, color: Colors.textMuted, marginTop: 3 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
  badgeWl: { borderColor: '#92400e' },
  badgeDisc: { borderColor: Colors.border },
  badgeText: { fontSize: 13, fontWeight: '500' },
  badgeTextBrand: { color: Colors.brand },
  badgeTextMuted: { color: Colors.textMuted },
  match: { fontSize: 14, color: Colors.brand, fontWeight: '600' },
  meta: { fontSize: 14, color: Colors.textMuted },
  scores: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  reason: { fontSize: 15, color: Colors.textSecondary, lineHeight: 23 },
  streaming: { flexDirection: 'row', gap: 10 },
  streamLogo: { width: 32, height: 32, borderRadius: 8 },
})
