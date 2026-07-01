"use client"

import Image from "next/image"
import { useState } from "react"
import type { Pick } from "@/lib/api"

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

function PosterImage({ path, title }: { path: string | null; title: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="w-full aspect-[2/3] sm:aspect-auto sm:w-40 sm:h-60 sm:flex-shrink-0 rounded-lg overflow-hidden bg-neutral-800">
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

interface Props {
  pick: Pick
  badgeOverride?: string
  animationDelay?: number
}

export function PickCard({ pick, badgeOverride, animationDelay }: Props) {
  return (
    <a
      href={`https://letterboxd.com/tmdb/${pick.id}/`}
      target="_blank"
      rel="noopener noreferrer"
      style={animationDelay != null ? { animationDelay: `${animationDelay}ms` } : undefined}
      className="animate-fade-in-up flex flex-col sm:flex-row gap-4 sm:gap-5 bg-neutral-900/50 border border-neutral-800/70 rounded-xl p-4 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-neutral-900/80 hover:shadow-lg hover:shadow-amber-900/20 transition-[transform,border-color,background-color,box-shadow] duration-200 cursor-pointer"
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
              badgeOverride || pick.source === "watchlist"
                ? "border-amber-800 text-brand"
                : "border-neutral-700 text-neutral-400"
            }`}>
              {badgeOverride ?? (pick.source === "watchlist" ? "On your watchlist" : "New discovery")}
            </span>
            {pick.match_pct != null && (
              <span className="text-xs text-brand font-medium">{pick.match_pct}% match</span>
            )}
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
          <div className="flex items-center gap-3">
            {pick.scores.rt && (
              <span className="flex items-center gap-1.5">
                <span className="group relative inline-flex items-center cursor-default">
                  <span className="text-[10px] font-bold leading-none bg-[#FA320A] text-white px-1.5 py-1 rounded">RT</span>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                    Rotten Tomatoes
                  </span>
                </span>
                <span className="meta">{pick.scores.rt}</span>
              </span>
            )}
            {pick.scores.imdb && (
              <span className="flex items-center gap-1.5">
                <span className="group relative inline-flex items-center cursor-default">
                  <span className="text-[10px] font-bold leading-none bg-[#F5C518] text-black px-1.5 py-1 rounded">IMDb</span>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                    IMDb
                  </span>
                </span>
                <span className="meta">{pick.scores.imdb}</span>
              </span>
            )}
            {pick.scores.metacritic && (
              <span className="flex items-center gap-1.5">
                <span className="group relative inline-flex items-center cursor-default">
                  <span className={`text-[10px] font-bold leading-none px-1.5 py-1 rounded text-white ${
                    parseInt(pick.scores.metacritic) >= 61 ? "bg-[#54A72A]" :
                    parseInt(pick.scores.metacritic) >= 40 ? "bg-[#FFCC34] !text-black" :
                    "bg-[#E32400]"
                  }`}>MC</span>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                    Metacritic
                  </span>
                </span>
                <span className="meta">{pick.scores.metacritic}</span>
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
  )
}
