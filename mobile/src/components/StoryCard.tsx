import { View, Text, StyleSheet } from 'react-native'
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg'
import { PrintLogo } from './PrintLogo'
import { FilmprintText } from './FilmprintText'
import { Colors } from '@/constants/theme'

export const CARD_W = 390
export const CARD_H = Math.round(CARD_W * (16 / 9))

const RS = 230, RC = RS / 2, RR = RS * 0.38, RL = RR + 30, RP = 40

function StaticRadar({ data }: { data: { name: string; weight: number }[] }) {
  const top = data.slice(0, 8)
  const N = top.length
  if (N < 3) return null

  const maxW = Math.max(...top.map(d => d.weight), 0.01)
  const angles = top.map((_, i) => (i / N) * 2 * Math.PI - Math.PI / 2)
  const pts = top.map((d, i) => ({
    x: RC + (d.weight / maxW) * RR * Math.cos(angles[i]),
    y: RC + (d.weight / maxW) * RR * Math.sin(angles[i]),
  }))
  const polygon = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const vb = RS + RP * 2

  return (
    <Svg viewBox={`${-RP} ${-RP} ${vb} ${vb}`} width={CARD_W - 56} height={CARD_W - 56}>
      {[0.25, 0.5, 0.75, 1.0].map(r => (
        <Circle key={r} cx={RC} cy={RC} r={r * RR} fill="none" stroke="#262626" strokeWidth={1} />
      ))}
      {angles.map((a, i) => (
        <Line key={i} x1={RC} y1={RC}
          x2={RC + RR * Math.cos(a)} y2={RC + RR * Math.sin(a)}
          stroke="#262626" strokeWidth={1} />
      ))}
      <Polygon points={polygon}
        fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.9)"
        strokeWidth={2.5} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={4} fill="#fbbf24" />
      ))}
      {top.map((d, i) => {
        const lx = RC + RL * Math.cos(angles[i])
        const ly = RC + RL * Math.sin(angles[i])
        const label = d.name.length > 10 ? d.name.slice(0, 9) + '…' : d.name
        return (
          <SvgText key={d.name} x={lx} y={ly} textAnchor="middle" fontSize={10} fill="#737373">
            {label}
          </SvgText>
        )
      })}
    </Svg>
  )
}

interface StoryCardProps {
  username: string
  genres: { name: string; weight: number }[]
  ratingsCount: number
  avgRating: number
  criticAlignment: number
}

export function StoryCard({ username, genres, ratingsCount, avgRating, criticAlignment }: StoryCardProps) {
  const maxW = genres[0]?.weight ?? 0.01
  const top4 = genres.slice(0, 4)

  const a = criticAlignment
  const criticLine = a > 0.75
    ? `+${(a / 2).toFixed(1)}★ vs critics`
    : a < -0.75
    ? `${(a / 2).toFixed(1)}★ vs critics`
    : 'in sync with critics'

  return (
    <View style={s.card}>
      <View style={s.header}>
        <PrintLogo size={38} noAnimate />
        <View style={s.headerRight}>
          <FilmprintText width={92} />
          <Text style={s.username}>@{username}</Text>
        </View>
      </View>

      <View style={s.divider} />

      <View style={s.radarWrap}>
        <StaticRadar data={genres} />
      </View>

      <View style={s.bars}>
        {top4.map(g => (
          <View key={g.name} style={s.barRow}>
            <Text style={s.barLabel}>{g.name}</Text>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${Math.round((g.weight / maxW) * 100)}%` as any }]} />
            </View>
          </View>
        ))}
      </View>

      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statVal}>{ratingsCount.toLocaleString()}</Text>
          <Text style={s.statLbl}>films rated</Text>
        </View>
        <View style={s.statSep} />
        <View style={s.stat}>
          <Text style={s.statVal}>{avgRating.toFixed(1)}★</Text>
          <Text style={s.statLbl}>avg rating</Text>
        </View>
        <View style={s.statSep} />
        <View style={s.stat}>
          <Text style={s.statVal}>{criticLine}</Text>
          <Text style={s.statLbl}>critic alignment</Text>
        </View>
      </View>

      <Text style={s.footer}>myfilmprint.com</Text>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: Colors.background,
    paddingHorizontal: 28,
    paddingTop: 44,
    paddingBottom: 36,
    gap: 22,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerRight: { gap: 5 },
  username: { fontSize: 13, color: Colors.textMuted, letterSpacing: 0.2 },
  divider: { height: 1, backgroundColor: Colors.border },
  radarWrap: { alignItems: 'center' },
  bars: { gap: 9 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 104, fontSize: 12, color: Colors.textSecondary },
  barTrack: { flex: 1, height: 5, backgroundColor: Colors.border, borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.brand, borderRadius: 99 },
  stats: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden',
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 13, gap: 3 },
  statVal: { fontSize: 13, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  statLbl: { fontSize: 10, color: Colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 },
  statSep: { width: 1, height: '55%', backgroundColor: Colors.border },
  footer: {
    fontSize: 11, color: Colors.textFaint, textAlign: 'center',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
})
