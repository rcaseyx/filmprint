"use client"

import Image from "next/image"
import { useEffect, useState } from "react"

interface Film {
  id: number
  title: string
  poster_path: string | null
}

interface Props {
  topFilms: Film[]
}

const STEPS = [
  "Reading your taste profile",
  "Scanning your watchlist",
  "Finding candidates",
  "Asking Claude for your picks",
]

const STEP_DELAYS_MS = [5000, 11000, 17000]

const MESSAGES = [
  "Good taste takes time.",
  "Cross-referencing your 3am watchlist additions.",
  "Sorting the gems from the good-enough.",
  "Finding films worth the runtime.",
  "This one's worth the wait.",
  "Claude is watching your watchlist.",
]

export function RecommendationLoader({ topFilms }: Props) {
  const [step, setStep] = useState(0)
  const [messageIdx, setMessageIdx] = useState(0)

  useEffect(() => {
    const timers = STEP_DELAYS_MS.map((delay, i) =>
      setTimeout(() => setStep(i + 1), delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIdx((i) => (i + 1) % MESSAGES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-10 py-8">
      {topFilms.length > 0 && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-3">
            {topFilms.map((film) => (
              <div key={film.id} className="w-[72px] h-[108px] rounded-lg overflow-hidden bg-neutral-800 shrink-0">
                {film.poster_path ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w154${film.poster_path}`}
                    alt={film.title}
                    width={72}
                    height={108}
                    className="object-cover w-full h-full opacity-80"
                  />
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-600 tracking-wide uppercase">Starting from your favorites</p>
        </div>
      )}

      <div className="flex flex-col gap-3 w-full max-w-xs">
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
                {label}
              </span>
            </div>
          )
        })}
      </div>

      <p
        key={messageIdx}
        className="animate-fade-in text-xs text-neutral-600 italic tracking-wide"
      >
        {MESSAGES[messageIdx]}
      </p>
    </div>
  )
}
