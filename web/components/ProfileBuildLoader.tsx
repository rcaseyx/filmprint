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
  ratedFilms: Film[]
}

const STEPS = [
  "Analyzing your ratings",
  "Mapping your taste profile",
  "Finding your first recommendations",
]

const STEP_DELAYS_MS = [3000, 7000, 12000]

const POSTER_STAGGER_MS = 280
const POSTER_DURATION_MS = 650
const OVERLAY_START_MS = 1400
const OVERLAY_DURATION_MS = 900
const OVERLAY_STAGGER_MS = 320
const STARS_OFFSET_MS = 500

function FilmStars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span className="text-brand text-xl tracking-wide select-none">
      {"★".repeat(full)}{half ? "½" : ""}
    </span>
  )
}

export function ProfileBuildLoader({ ratedFilms }: Props) {
  const [step, setStep] = useState(0)
  const [dotCount, setDotCount] = useState(1)

  const posters = ratedFilms
    .filter((f) => f.poster_path)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3)

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
          <div className="flex gap-3 justify-center">
            {posters.map((film, i) => (
              <div
                key={film.id}
                className={`relative w-40 h-60 rounded-lg overflow-hidden bg-neutral-800 shrink-0 ${i === 2 ? "hidden sm:block" : ""}`}
              >
                <Image
                  src={`https://image.tmdb.org/t/p/w342${film.poster_path}`}
                  alt={film.title}
                  width={160}
                  height={240}
                  className="object-cover w-full h-full animate-fade-in"
                  style={{
                    animationDelay: `${i * POSTER_STAGGER_MS}ms`,
                    animationDuration: `${POSTER_DURATION_MS}ms`,
                  }}
                />
                <div
                  className="absolute inset-0 bg-neutral-950/75 flex items-center justify-center animate-fade-in"
                  style={{
                    animationDelay: `${OVERLAY_START_MS + i * OVERLAY_STAGGER_MS}ms`,
                    animationDuration: `${OVERLAY_DURATION_MS}ms`,
                  }}
                >
                  <div
                    className="animate-loader-stars-rise"
                    style={{
                      animationDelay: `${OVERLAY_START_MS + STARS_OFFSET_MS + i * OVERLAY_STAGGER_MS}ms`,
                    }}
                  >
                    <FilmStars rating={film.rating} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-neutral-400 tracking-wide uppercase">Starting from your ratings</p>
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
