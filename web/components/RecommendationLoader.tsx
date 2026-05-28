"use client"

import Image from "next/image"
import { useEffect, useState } from "react"

interface Film {
  id: number
  title: string
  poster_path: string | null
  rating: number
}

interface Props {
  genreExamples: Record<string, Film[]>
  selectedGenres: string[]
}

const STEPS = [
  "Reading your taste profile",
  "Scanning your watchlist",
  "Finding candidates",
  "Composing your picks",
]

const STEP_DELAYS_MS = [5000, 11000, 17000]

// Stagger timings for poster and overlay animations
const POSTER_STAGGER_MS = 180
const OVERLAY_START_MS = 700
const OVERLAY_STAGGER_MS = 220

function pickPosters(genreExamples: Record<string, Film[]>, selectedGenres: string[], count = 3): Film[] {
  const seen = new Set<number>()
  const result: Film[] = []

  const preferred = selectedGenres
    .flatMap((g) => [...(genreExamples[g] || [])])
    .sort(() => Math.random() - 0.5)

  for (const film of preferred) {
    if (!seen.has(film.id) && result.length < count) {
      seen.add(film.id)
      result.push(film)
    }
  }

  if (result.length < count) {
    const all = Object.values(genreExamples).flat().sort(() => Math.random() - 0.5)
    for (const film of all) {
      if (!seen.has(film.id) && result.length < count) {
        seen.add(film.id)
        result.push(film)
      }
    }
  }

  return result
}

function FilmStars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span className="text-brand text-xl tracking-wide select-none">
      {"★".repeat(full)}{half ? "½" : ""}
    </span>
  )
}

export function RecommendationLoader({ genreExamples, selectedGenres }: Props) {
  const [posters] = useState(() => pickPosters(genreExamples, selectedGenres))
  const [step, setStep] = useState(0)
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const timers = STEP_DELAYS_MS.map((delay, i) =>
      setTimeout(() => setStep(i + 1), delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((n) => (n % 3) + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-10 py-8">
      {posters.length > 0 && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-3">
            {posters.map((film, i) => (
              <div
                key={film.id}
                className="relative w-40 h-60 rounded-lg overflow-hidden bg-neutral-800 shrink-0"
              >
                {film.poster_path ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w342${film.poster_path}`}
                    alt={film.title}
                    width={160}
                    height={240}
                    className="object-cover w-full h-full animate-fade-in"
                    style={{
                      animationDelay: `${i * POSTER_STAGGER_MS}ms`,
                      animationDuration: "400ms",
                    }}
                  />
                ) : null}

                {/* Rating overlay */}
                <div
                  className="absolute inset-0 bg-neutral-950/75 flex items-center justify-center animate-fade-in"
                  style={{
                    animationDelay: `${OVERLAY_START_MS + i * OVERLAY_STAGGER_MS}ms`,
                    animationDuration: "500ms",
                  }}
                >
                  <div
                    className="animate-loader-stars-rise"
                    style={{
                      animationDelay: `${OVERLAY_START_MS + 100 + i * OVERLAY_STAGGER_MS}ms`,
                    }}
                  >
                    <FilmStars rating={film.rating} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-600 tracking-wide uppercase">Starting from your favorites</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {STEPS.map((label, i) => {
          const done = i < step
          const active = i === step
          return (
            <div
              key={label}
              className={`flex items-center gap-3 transition-opacity duration-500 ${
                i > step ? "opacity-25" : "opacity-100"
              }`}
            >
              <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                {done ? (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
                    <circle cx="10" cy="10" r="9" stroke="rgb(251 191 36)" strokeWidth="1.5" />
                    <path d="M6 10l3 3 5-5" stroke="rgb(251 191 36)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <span className="w-2 h-2 rounded-full bg-brand animate-pulse mx-auto block" />
                ) : (
                  <span className="w-2 h-2 rounded-full border border-neutral-700 mx-auto block" />
                )}
              </div>
              <span className={`text-sm ${done ? "text-neutral-500" : active ? "text-neutral-100" : "text-neutral-600"}`}>
                {active ? (
                  <>{label}<span aria-hidden="true">{".".repeat(dotCount)}<span className="invisible">{".".repeat(3 - dotCount)}</span></span></>
                ) : label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
