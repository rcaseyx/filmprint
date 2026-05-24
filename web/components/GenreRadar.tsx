"use client"

import Image from "next/image"
import { useRef, useState } from "react"

interface DataPoint {
  name: string
  weight: number
  count?: number
  shortName?: string
}

interface Example {
  id: number
  title: string
  year: number | null
  rating: number
  poster_path: string | null
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
  const [hovered, setHovered] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [examples, setExamples] = useState<Record<number, Example[]>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const fetchedRef = useRef<Set<number>>(new Set())

  const top = data.slice(0, 8)
  const N = top.length
  if (N < 3) return null

  const SIZE = 220
  const CENTER = SIZE / 2
  const RADIUS = SIZE * 0.42
  const LABEL_R = RADIUS + 30
  const PAD = 40

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

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 })
  }

  const handleVertexEnter = (i: number) => {
    setHovered(i)
    if (fetchedRef.current.has(i)) return
    fetchedRef.current.add(i)
    const name = top[i].name
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile/genre/${encodeURIComponent(name)}/examples`)
      .then((r) => r.json())
      .then((d) => setExamples((prev) => ({ ...prev, [i]: d.examples })))
      .catch(() => setExamples((prev) => ({ ...prev, [i]: [] })))
  }

  const hoveredPoint = hovered !== null ? top[hovered] : null
  const hoveredExamples = hovered !== null ? (examples[hovered] ?? null) : null

  return (
    <div ref={containerRef} className="relative flex flex-col items-center gap-2">
      {hoveredPoint && (
        <div
          className="absolute z-10 pointer-events-none bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2.5 text-xs shadow-xl"
          style={{ left: tooltipPos.x, top: tooltipPos.y, transform: "translateY(-100%)", minWidth: "10rem", maxWidth: "14rem" }}
        >
          <div className="font-medium text-neutral-100">{hoveredPoint.name}</div>
          <div className="text-neutral-500 mt-0.5 mb-2">
            {Math.round((hoveredPoint.weight / maxWeight) * 100)}% affinity
            {hoveredPoint.count !== undefined && ` · ${hoveredPoint.count} films`}
          </div>
          <div className="border-t border-neutral-800 pt-2 flex gap-2">
            {hoveredExamples === null ? (
              // Placeholders hold size while loading
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1 w-[64px]">
                  <div className="w-[64px] h-[96px] rounded bg-neutral-800" />
                  <div className="h-2 w-10 rounded bg-neutral-800" />
                </div>
              ))
            ) : hoveredExamples.map((ex) => (
              <div key={ex.id} className="flex flex-col items-center gap-1 w-[64px]">
                <div className="w-[64px] h-[96px] rounded overflow-hidden bg-neutral-800 shrink-0">
                  {ex.poster_path ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w92${ex.poster_path}`}
                      alt={ex.title}
                      width={64}
                      height={96}
                      className="object-cover w-full h-full"
                    />
                  ) : null}
                </div>
                <span className="text-xs text-neutral-400 text-center leading-tight line-clamp-2 w-full">{ex.title}</span>
                <span className="text-xs text-amber-400 mt-auto">★{ex.rating}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <span className="text-xs text-neutral-500 uppercase tracking-wider">{label}</span>
      <svg
        viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
        className="w-full h-auto animate-fade-in"
        aria-hidden
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
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
          <g
            key={i}
            onMouseEnter={() => handleVertexEnter(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: "default" }}
          >
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={6}
              fill={hovered === i ? "rgba(251,191,36,0.45)" : "rgba(251,191,36,0.18)"} />
            <circle cx={p.x} cy={p.y} r={hovered === i ? 4 : 3}
              fill="#fbbf24" />
          </g>
        ))}
        {top.map((d, i) => {
          const x = CENTER + LABEL_R * Math.cos(angles[i])
          const y = CENTER + LABEL_R * Math.sin(angles[i])
          const [line1, line2] = splitLabel(d.shortName ?? d.name)
          return (
            <text key={d.name} x={x} y={y}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={10}
              fill={hovered === i ? "#a3a3a3" : "#737373"}>
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
