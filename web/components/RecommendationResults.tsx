"use client"

import Image from "next/image"

interface StreamingProvider {
  name: string
  logo_path: string
}

// Only render logos for services in this list — anything more niche gets skipped.
const STREAMING_WHITELIST: Record<string, string> = {
  "Netflix":              "https://www.netflix.com",
  "Amazon Prime Video":   "https://www.primevideo.com",
  "Disney+":              "https://www.disneyplus.com",
  "Max":                  "https://www.max.com",
  "HBO Max":              "https://www.max.com",
  "Hulu":                 "https://www.hulu.com",
  "Apple TV+":            "https://tv.apple.com",
  "Peacock":              "https://www.peacocktv.com",
  "Paramount+":           "https://www.paramountplus.com",
  "Starz":                "https://www.starz.com",
  "MGM+":                 "https://www.mgmplus.com",
  "AMC+":                 "https://www.amcplus.com",
  "Shudder":              "https://www.shudder.com",
  "Criterion Channel":    "https://www.criterionchannel.com",
  "MUBI":                 "https://mubi.com",
  "Tubi":                 "https://tubitv.com",
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
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight">Tonight's picks</h2>
      </div>

      <div className="space-y-6 pb-2">
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
                <div className="flex items-center gap-1.5 mt-3">
                  {pick.streaming
                    .filter((p) => p.name in STREAMING_WHITELIST)
                    .slice(0, 5)
                    .map((p) => (
                      <a
                        key={p.logo_path}
                        href={STREAMING_WHITELIST[p.name]}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={p.name}
                      >
                        <Image
                          src={`https://image.tmdb.org/t/p/original${p.logo_path}`}
                          alt={p.name}
                          width={24}
                          height={24}
                          className="rounded-md"
                        />
                      </a>
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onReset}
        className="mt-8 w-full py-3 rounded-lg border border-neutral-700 text-neutral-300 text-sm font-medium hover:border-neutral-500 hover:text-neutral-100 transition-colors"
      >
        Start over
      </button>
    </div>
  )
}
