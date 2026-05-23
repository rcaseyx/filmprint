interface DataPoint {
  name: string
  weight: number
  shortName?: string
}

interface Props {
  data: DataPoint[]
  label: string
}

function splitLabel(text: string, maxLen = 10): [string, string | null] {
  if (text.length <= maxLen) return [text, null]
  const pivot = text.lastIndexOf(" ", maxLen)
  if (pivot > 0) return [text.slice(0, pivot), text.slice(pivot + 1)]
  const dash = text.lastIndexOf("-", maxLen)
  if (dash > 0) return [text.slice(0, dash), text.slice(dash + 1)]
  return [text, null]
}

export function GenreRadar({ data, label }: Props) {
  const top = data.slice(0, 8)
  const N = top.length
  if (N < 3) return null

  const SIZE = 220
  const CENTER = SIZE / 2
  const RADIUS = SIZE * 0.42
  const LABEL_R = RADIUS + 30
  const PAD = 40  // viewBox padding so labels never bleed outside the SVG

  const maxWeight = Math.max(...top.map((d) => Math.abs(d.weight)), 0.01)
  const angles = top.map((_, i) => (i / N) * 2 * Math.PI - Math.PI / 2)

  const dataPoints = top.map((d, i) => {
    const r = Math.max(0, (d.weight / maxWeight) * RADIUS)
    return {
      x: CENTER + r * Math.cos(angles[i]),
      y: CENTER + r * Math.sin(angles[i]),
    }
  })

  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ")

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">{label}</span>
      <svg
        viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
        className="w-full h-auto animate-fade-in"
        aria-hidden
      >
        <defs>
          <filter id={`glow-${label}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75, 1.0].map((r) => (
          <circle key={r} cx={CENTER} cy={CENTER} r={r * RADIUS}
            fill="none" stroke="#2a2a2a" strokeWidth={1} />
        ))}
        {angles.map((a, i) => (
          <line key={i} x1={CENTER} y1={CENTER}
            x2={CENTER + RADIUS * Math.cos(a)} y2={CENTER + RADIUS * Math.sin(a)}
            stroke="#2a2a2a" strokeWidth={1} />
        ))}
        <polygon points={polygon}
          fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.9)"
          strokeWidth={2} strokeLinejoin="round"
          filter={`url(#glow-${label})`} />
        {dataPoints.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={6} fill="rgba(251,191,36,0.18)" />
            <circle cx={p.x} cy={p.y} r={3} fill="#fbbf24" />
          </g>
        ))}
        {top.map((d, i) => {
          const x = CENTER + LABEL_R * Math.cos(angles[i])
          const y = CENTER + LABEL_R * Math.sin(angles[i])
          const [line1, line2] = splitLabel(d.shortName ?? d.name)
          return (
            <text key={d.name} x={x} y={y}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill="#737373">
              {line2 ? (
                <>
                  <tspan x={x} dy="-0.55em">{line1}</tspan>
                  <tspan x={x} dy="1.2em">{line2}</tspan>
                </>
              ) : line1}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
