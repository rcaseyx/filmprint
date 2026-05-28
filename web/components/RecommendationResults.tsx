"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"

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
  onRefresh: () => void
  refreshing?: boolean
}

function PosterImage({ path, title }: { path: string | null; title: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="flex-shrink-0 w-40 h-60 rounded-lg overflow-hidden bg-neutral-800">
      {path ? (
        <Image
          src={`https://image.tmdb.org/t/p/w342${path}`}
          alt={title}
          width={160}
          height={240}
          className={`object-cover w-full h-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-700 text-sm text-center p-3">
          No poster
        </div>
      )}
    </div>
  )
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
          <a
            key={pick.id}
            href={`https://letterboxd.com/tmdb/${pick.id}/`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ animationDelay: `${index * 80}ms` }}
            className="animate-fade-in-up flex gap-5 bg-neutral-900/50 border border-neutral-800/70 rounded-xl p-4 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-neutral-900/80 hover:shadow-lg hover:shadow-amber-900/20 transition-[transform,border-color,background-color,box-shadow] duration-200 cursor-pointer"
          >
            {/* Poster */}
            <PosterImage path={pick.poster_path} title={pick.title} />

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col gap-2.5 py-1">
              {/* Title row */}
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg leading-tight">{pick.title}</h3>
                  <span className="text-neutral-500">{pick.year}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    pick.source === "watchlist"
                      ? "border-amber-800 text-brand"
                      : "border-neutral-700 text-neutral-400"
                  }`}>
                    {pick.source === "watchlist" ? "On your watchlist" : "New discovery"}
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
                <div className="flex items-center gap-4">
                  {pick.scores.rt && (
                    <span className="flex items-center gap-1.5 meta">
                      <svg viewBox="0 0 18 20" className="h-4 w-auto shrink-0" aria-label="Rotten Tomatoes">
                        <path d="M9 7.5C9 7.5 5.5 3.5 4 4.5C2.5 5.5 6 7 9 7.5Z" fill="#56A348"/>
                        <path d="M9 7.5C9 7.5 12.5 3.5 14 4.5C15.5 5.5 12 7 9 7.5Z" fill="#56A348"/>
                        <line x1="9" y1="7.5" x2="9" y2="11" stroke="#56A348" strokeWidth="1.8"/>
                        <circle cx="9" cy="15" r="5.5" fill="#E8262A"/>
                      </svg>
                      {pick.scores.rt}
                    </span>
                  )}
                  {pick.scores.imdb && (
                    <span className="flex items-center gap-1.5 meta">
                      <svg viewBox="0 0 44 18" className="h-[14px] w-auto shrink-0" aria-label="IMDb">
                        <rect width="44" height="18" rx="2.5" fill="#F5C518"/>
                        <text x="4" y="13.5" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="12" fill="#000000">IMDb</text>
                      </svg>
                      {pick.scores.imdb}
                    </span>
                  )}
                  {pick.scores.metacritic && (
                    <span className="flex items-center gap-1.5 meta">
                      <svg viewBox="0 0 26 18" className="h-[14px] w-auto shrink-0" aria-label="Metacritic">
                        <rect width="26" height="18" rx="2.5" fill="#222222"/>
                        <text x="3.5" y="13.5" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="12" fill="#FFFFFF">MC</text>
                      </svg>
                      {pick.scores.metacritic}
                    </span>
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
                      <Image
                        key={p.logo_path}
                        src={`https://image.tmdb.org/t/p/original${p.logo_path}`}
                        alt={p.name}
                        title={p.name}
                        width={28}
                        height={28}
                        className="rounded-md opacity-70"
                      />
                    ))}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
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
        <button
          onClick={onReset}
          className="btn-secondary w-full py-3 text-sm font-medium"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
