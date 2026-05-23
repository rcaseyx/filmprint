"use client"

import Image from "next/image"

interface StreamingProvider {
  name: string
  logo_path: string
}

interface Pick {
  id: number
  title: string
  year: number | string
  source: "watchlist" | "discovered"
  score: number
  reason: string
  poster_path: string | null
  genres: string[]
  runtime: number | null
  streaming: StreamingProvider[]
}

interface Props {
  picks: Pick[]
  onReset: () => void
}

export function RecommendationResults({ picks, onReset }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold tracking-tight">Tonight's picks</h2>
        <button
          onClick={onReset}
          className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          ← Start over
        </button>
      </div>

      <div className="space-y-6">
        {picks.map((pick) => (
          <div key={pick.id} className="flex gap-4">
            {/* Poster */}
            <div className="flex-shrink-0 w-20 h-30 rounded-lg overflow-hidden bg-neutral-800">
              {pick.poster_path ? (
                <Image
                  src={`https://image.tmdb.org/t/p/w200${pick.poster_path}`}
                  alt={pick.title}
                  width={80}
                  height={120}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs text-center p-2">
                  No poster
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="font-semibold">{pick.title}</h3>
                <span className="text-neutral-500 text-sm">{pick.year}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  pick.source === "watchlist"
                    ? "border-blue-800 text-blue-400"
                    : "border-neutral-700 text-neutral-500"
                }`}>
                  {pick.source === "watchlist" ? "watchlist" : "discovered"}
                </span>
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                {pick.genres.slice(0, 3).map((g) => (
                  <span key={g} className="text-xs text-neutral-500">{g}</span>
                ))}
                {pick.runtime && (
                  <span className="text-xs text-neutral-500">{pick.runtime}min</span>
                )}
              </div>
              <p className="text-sm text-neutral-300 mt-2 leading-relaxed">{pick.reason}</p>

              {/* Streaming providers */}
              {pick.streaming?.length > 0 && (
                <div className="flex items-center gap-2 mt-3">
                  {pick.streaming.slice(0, 4).map((p) => (
                    <Image
                      key={p.name}
                      src={`https://image.tmdb.org/t/p/original${p.logo_path}`}
                      alt={p.name}
                      title={p.name}
                      width={24}
                      height={24}
                      className="rounded-md"
                    />
                  ))}
                  <span className="text-xs text-neutral-500">
                    {pick.streaming.slice(0, 4).map((p) => p.name).join(" · ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
