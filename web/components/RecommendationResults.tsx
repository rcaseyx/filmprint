"use client"

import Image from "next/image"

interface StreamingProvider {
  name: string
  logo_path: string
}

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

interface Scores {
  imdb: string | null
  rt: string | null
  metacritic: string | null
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
  scores: Scores
}

interface Props {
  picks: Pick[]
  onReset: () => void
}

export function RecommendationResults({ picks, onReset }: Props) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight mb-6">Tonight's picks</h2>

      <div className="space-y-4">
        {picks.map((pick) => (
          <div key={pick.id} className="flex gap-5 bg-neutral-900/50 border border-neutral-800/70 rounded-xl p-4">
            {/* Poster */}
            <div className="flex-shrink-0 w-40 h-60 rounded-lg overflow-hidden bg-neutral-800">
              {pick.poster_path ? (
                <Image
                  src={`https://image.tmdb.org/t/p/w200${pick.poster_path}`}
                  alt={pick.title}
                  width={160}
                  height={240}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-700 text-sm text-center p-3">
                  No poster
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col gap-2.5 py-1">
              {/* Title row */}
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg leading-tight">{pick.title}</h3>
                  <span className="text-neutral-500">{pick.year}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    pick.source === "watchlist"
                      ? "border-amber-800 text-amber-400"
                      : "border-neutral-700 text-neutral-500"
                  }`}>
                    {pick.source}
                  </span>
                </div>

                {/* Genres + runtime */}
                <div className="flex gap-3 mt-1.5 flex-wrap">
                  {pick.genres.slice(0, 3).map((g) => (
                    <span key={g} className="meta">{g}</span>
                  ))}
                  {pick.runtime && (
                    <span className="meta">{pick.runtime}m</span>
                  )}
                </div>
              </div>

              {/* Scores */}
              {(pick.scores.rt || pick.scores.imdb || pick.scores.metacritic) && (
                <div className="flex gap-4">
                  {pick.scores.rt && (
                    <span className="meta">🍅 {pick.scores.rt}</span>
                  )}
                  {pick.scores.imdb && (
                    <span className="meta">IMDb {pick.scores.imdb}</span>
                  )}
                  {pick.scores.metacritic && (
                    <span className="meta">MC {pick.scores.metacritic}</span>
                  )}
                </div>
              )}

              {/* Reason */}
              <p className="text-base text-neutral-300 leading-relaxed">{pick.reason}</p>

              {/* Streaming */}
              {pick.streaming?.length > 0 && (
                <div className="flex items-center gap-2 mt-auto pt-1">
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
                          width={28}
                          height={28}
                          className="rounded-md opacity-80 hover:opacity-100 transition-opacity"
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
        className="mt-8 w-full py-3 rounded-lg border border-neutral-800 text-neutral-500 text-sm font-medium hover:border-neutral-600 hover:text-neutral-300 transition-colors"
      >
        Start over
      </button>
    </div>
  )
}
