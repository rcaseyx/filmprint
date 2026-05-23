interface DataPoint {
  name: string
  weight: number
  shortName?: string
}

interface Props {
  data: DataPoint[]
  label: string
}

export function GenreRadar({ data, label }: Props) {
  const top = data.slice(0, 8)
  const N = top.length
  if (N < 3) return null

  const SIZE = 220
  const CENTER = SIZE / 2
  const RADIUS = SIZE * 0.36
  const LABEL_R = RADIUS + 26

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
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full h-auto"
        overflow="visible"
        aria-hidden
      >
        {[0.25, 0.5, 0.75, 1.0].map((r) => (
          <circle key={r} cx={CENTER} cy={CENTER} r={r * RADIUS}
            fill="none" stroke="#262626" strokeWidth={1} />
        ))}
        {angles.map((a, i) => (
          <line key={i} x1={CENTER} y1={CENTER}
            x2={CENTER + RADIUS * Math.cos(a)} y2={CENTER + RADIUS * Math.sin(a)}
            stroke="#262626" strokeWidth={1} />
        ))}
        <polygon points={polygon}
          fill="rgba(251,191,36,0.08)" stroke="rgba(251,191,36,0.7)"
          strokeWidth={1.5} strokeLinejoin="round" />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#fbbf24" />
        ))}
        {top.map((d, i) => {
          const x = CENTER + LABEL_R * Math.cos(angles[i])
          const y = CENTER + LABEL_R * Math.sin(angles[i])
          return (
            <text key={d.name} x={x} y={y}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill="#737373">
              {d.shortName ?? d.name}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
