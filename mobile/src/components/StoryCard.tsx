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
    <Svg viewBox={`${-RP} ${-RP} ${vb} ${vb}`} width={CARD_W - 28} height={CARD_W - 28}>
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
        const label = d.name
        return (
          <SvgText key={d.name} x={lx} y={ly} textAnchor="middle" fontSize={10} fill="#737373">
            {label}
          </SvgText>
        )
      })}
    </Svg>
  )
}

function DecadeStrip({ data }: { data: { name: string; weight: number }[] }) {
  const filtered = data.filter(d => d.weight > 0)
  if (filtered.length === 0) return null

  const maxW = Math.max(...filtered.map(d => d.weight))

  return (
    <View style={ds.wrap}>
      {filtered.map(d => (
        <View key={d.name} style={ds.col}>
          <View style={ds.colTrack}>
            <View style={[ds.colFill, { height: `${Math.round((d.weight / maxW) * 100)}%` as any }]} />
          </View>
          <Text style={ds.colLabel}>{d.name.slice(2)}</Text>
        </View>
      ))}
    </View>
  )
}

interface StoryCardProps {
  username: string
  genres: { name: string; weight: number }[]
  decades: { name: string; weight: number }[]
  fpScore: number
  ratingsCount: number
  avgRating: number
  criticAlignment: number
}

export function StoryCard({ username, genres, decades, fpScore, ratingsCount, avgRating, criticAlignment }: StoryCardProps) {
  const a = criticAlignment
  const criticLine = a > 0.75
    ? `+${(a / 2).toFixed(1)}★`
    : a < -0.75
    ? `${(a / 2).toFixed(1)}★`
    : 'In sync'

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <PrintLogo size={38} noAnimate />
          <View style={s.headerMid}>
            <FilmprintText width={92} />
            <Text style={s.username}>@{username}</Text>
          </View>
        </View>
        <View style={s.scoreWrap}>
          <View style={s.scoreBox}>
            <Text style={s.scoreVal}>{fpScore}</Text>
          </View>
          <Text style={s.scoreLbl}>FILMPRINT SCORE</Text>
        </View>
      </View>

      <View style={s.divider} />

      <View style={s.radarWrap}>
        <StaticRadar data={genres} />
      </View>

      <DecadeStrip data={decades} />

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
          <Text style={s.statLbl}>vs. critics</Text>
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
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerMid: { gap: 5 },
  username: { fontSize: 13, color: Colors.textMuted, letterSpacing: 0.2 },
  scoreWrap: { alignItems: 'center', gap: 6 },
  scoreBox: {
    borderWidth: 1.5, borderColor: Colors.brand, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreVal: { fontSize: 24, fontWeight: '700', color: Colors.brand, letterSpacing: -0.5 },
  scoreLbl: { fontSize: 9, color: Colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.8 },
  divider: { height: 1, backgroundColor: Colors.border },
  radarWrap: { alignItems: 'center', marginHorizontal: -14 },
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

const ds = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 5 },
  colTrack: {
    width: '100%', height: 52,
    justifyContent: 'flex-end',
    borderRadius: 5, overflow: 'hidden',
    backgroundColor: Colors.border,
  },
  colFill: { width: '100%', backgroundColor: Colors.brand },
  colLabel: { fontSize: 10, color: Colors.textMuted, letterSpacing: 0.3 },
})
