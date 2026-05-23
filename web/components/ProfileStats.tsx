"use client"

import { useEffect, useRef, useState } from "react"

function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(0)
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])

  return value
}

interface Props {
  ratings: number
  watchlist: number
  candidates: number
}

export function ProfileStats({ ratings, watchlist, candidates }: Props) {
  const stats = [
    { label: "Ratings", value: useCountUp(ratings) },
    { label: "Watchlist", value: useCountUp(watchlist) },
    { label: "Candidates", value: useCountUp(candidates) },
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800">
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">{label}</div>
        </div>
      ))}
    </div>
  )
}
