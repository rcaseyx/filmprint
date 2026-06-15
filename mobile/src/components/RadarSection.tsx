import { useState, useRef } from 'react'
import {
  View, Text, TouchableOpacity, Modal,
  StyleSheet, Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import Svg, { Circle, Line, Polygon, Text as SvgText, TSpan, G } from 'react-native-svg'
import { Colors } from '@/constants/theme'

const TMDB = 'https://image.tmdb.org/t/p/w342'
const SIZE = 220, CENTER = SIZE / 2, RADIUS = SIZE * 0.42, LABEL_R = RADIUS + 34, PAD = 46
const VBOX_SIZE = SIZE + PAD * 2
const SCREEN_W = Dimensions.get('window').width
const SCREEN_H = Dimensions.get('window').height
const TOOLTIP_W = 212

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Axis { name: string; weight: number; count?: number; shortName?: string }

export interface Example {
  id: number; title: string; year: number | null
  rating: number; poster_path: string | null
}

export type RadarExamples = Record<string, Example[]>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitLabel(text: string, maxLen = 10): [string, string | null] {
  if (text.length <= maxLen) return [text, null]
  let pivot = text.lastIndexOf(' ', maxLen)
  if (pivot <= 0) pivot = text.indexOf(' ')
  if (pivot > 0) return [text.slice(0, pivot), text.slice(pivot + 1)]
  return [text, null]
}

// ─── SVG Radar ────────────────────────────────────────────────────────────────

function RNRadar({
  data, selected, onDotPress,
}: {
  data: Axis[]; selected: number | null
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
        {[0.25, 0.5, 0.75, 1.0].map(r => (
          <Circle key={r} cx={CENTER} cy={CENTER} r={r * RADIUS}
            fill="none" stroke={Colors.border} strokeWidth={1} />
        ))}
        {angles.map((a, i) => (
          <Line key={i} x1={CENTER} y1={CENTER}
            x2={CENTER + RADIUS * Math.cos(a)} y2={CENTER + RADIUS * Math.sin(a)}
            stroke={Colors.border} strokeWidth={1} />
        ))}
        <Polygon points={polygon}
          fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.9)"
          strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <G key={i} onPress={() => onDotPress(i, p.x, p.y)}>
            <Circle cx={p.x} cy={p.y} r={16} fill="transparent" />
            <Circle cx={p.x} cy={p.y} r={6}
              fill={selected === i ? 'rgba(251,191,36,0.45)' : 'rgba(251,191,36,0.18)'} />
            <Circle cx={p.x} cy={p.y} r={selected === i ? 4 : 3} fill="#fbbf24" />
          </G>
        ))}
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

// ─── Tooltip ──────────────────────────────────────────────────────────────────

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

export function RadarSection({
  genres, subgenres, decades, tone, examples,
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
    if (selected === i) { setSelected(null); setTooltipPos(null); return }
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
      <View style={rs.tabRow}>
        {RADAR_TABS.map(tab => (
          <TouchableOpacity key={tab} onPress={() => switchTab(tab)} style={rs.tab} activeOpacity={0.7}>
            <Text style={[rs.tabText, active === tab && rs.tabActive]}>{tab}</Text>
            {active === tab && <View style={rs.tabLine} />}
          </TouchableOpacity>
        ))}
      </View>
      <View ref={radarRef}>
        <RNRadar data={currentData} selected={selected} onDotPress={handleDotPress} />
      </View>
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
  tabRow: {
    flexDirection: 'row', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 8,
  },
  tab: { paddingHorizontal: 16, paddingBottom: 10, alignItems: 'center', position: 'relative' },
  tabText: { fontSize: 14, color: Colors.textMuted },
  tabActive: { color: Colors.text },
  tabLine: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 1, backgroundColor: Colors.brand },
})
