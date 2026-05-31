"use client"

import { useEffect, useState } from "react"

function useCountUp(target: number, duration = 700, decimals = 0) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -8 * progress)
      setValue(parseFloat((target * eased).toFixed(decimals)))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration, decimals])

  return value
}

interface Props {
  ratings: number
  watchlist: number
  avgRating: number
}

export function ProfileStats({ ratings, watchlist, avgRating }: Props) {
  const ratingsCount = useCountUp(ratings, 1600)
  const watchlistCount = useCountUp(watchlist, 1600)
  const avgRatingValue = useCountUp(avgRating, 1600, 1)

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800">
        <div className="text-3xl font-semibold tabular-nums">{ratingsCount}</div>
        <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">Ratings</div>
      </div>
      <div className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800">
        <div className="text-3xl font-semibold tabular-nums">{watchlistCount}</div>
        <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">Watchlist</div>
      </div>
      <div className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800">
        <div className="text-3xl font-semibold tabular-nums text-brand">{avgRatingValue.toFixed(1)}★</div>
        <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">Avg rating</div>
      </div>
    </div>
  )
}
