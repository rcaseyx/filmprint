"use client"

import { useEffect, useRef } from "react"
import type { Pick } from "@/lib/api"
import { PickCard } from "@/components/PickCard"

interface Props {
  picks: Pick[]
  onReset: () => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function RecommendationResults({ picks, onReset, onRefresh, refreshing }: Props) {
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!topRef.current) return
    const top = topRef.current.getBoundingClientRect().top + window.scrollY - 80
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  }, [picks])

  return (
    <div ref={topRef} className="animate-fade-in">
      <h2 className="text-2xl font-semibold tracking-tight mb-6">Your picks</h2>

      <div className="space-y-4">
        {picks.map((pick, index) => (
          <PickCard key={pick.id} pick={pick} animationDelay={index * 80} />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-primary w-full py-3 text-sm font-medium"
          >
            {refreshing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Finding more picks…
              </span>
            ) : "Show me different picks"}
          </button>
        )}
        <button
          onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); onReset() }}
          className="btn-secondary w-full py-3 text-sm font-medium"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
