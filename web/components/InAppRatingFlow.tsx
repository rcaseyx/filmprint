"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

const MIN_RATINGS = 8

interface SeedFilm {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

function StarRating({ value, onChange }: { value: number | null; onChange: (r: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const active = hovered ?? value ?? 0

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(null)}
          className="text-base leading-none transition-colors"
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
        >
          <span className={star <= active ? "text-brand" : "text-neutral-700"}>★</span>
        </button>
      ))}
    </div>
  )
}

function FilmCard({
  film,
  rating,
  skipped,
  onRate,
  onSkip,
}: {
  film: SeedFilm
  rating: number | null
  skipped: boolean
  onRate: (r: number) => void
  onSkip: () => void
}) {
  return (
    <div className={`flex flex-col gap-2 transition-opacity ${skipped ? "opacity-30" : ""}`}>
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800">
        {film.poster_path ? (
          <Image
            src={`https://image.tmdb.org/t/p/w185${film.poster_path}`}
            alt={film.title}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 45vw, 160px"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs text-center px-2">
            {film.title}
          </div>
        )}
        {rating !== null && (
          <div className="absolute top-1.5 right-1.5 bg-neutral-950/80 rounded px-1.5 py-0.5 text-xs text-brand font-medium">
            {"★".repeat(rating)}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-neutral-200 leading-tight line-clamp-2 font-medium">{film.title}</p>
        {film.year && <p className="text-xs text-neutral-600">{film.year}</p>}
        <StarRating value={rating} onChange={onRate} />
        {!skipped && rating === null && (
          <button
            onClick={onSkip}
            className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            Haven&rsquo;t seen it
          </button>
        )}
        {skipped && (
          <button
            onClick={onSkip}
            className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  )
}

export function InAppRatingFlow() {
  const router = useRouter()
  const { data: session } = useSession()
  const [films, setFilms] = useState<SeedFilm[]>([])
  const [ratings, setRatings] = useState<Record<number, number>>({})
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/onboarding/seed-films`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data: SeedFilm[]) => setFilms(data))
      .catch(() => setError("Couldn't load films — please try again."))
      .finally(() => setLoading(false))
  }, [session])

  const ratedCount = Object.keys(ratings).length
  const canSubmit = ratedCount >= MIN_RATINGS

  const handleRate = (movieId: number, star: number) => {
    setRatings((prev) => ({ ...prev, [movieId]: star }))
    setSkipped((prev) => { const s = new Set(prev); s.delete(movieId); return s })
  }

  const handleSkip = (movieId: number) => {
    setSkipped((prev) => {
      const s = new Set(prev)
      if (s.has(movieId)) {
        s.delete(movieId)
      } else {
        s.add(movieId)
        setRatings((r) => { const next = { ...r }; delete next[movieId]; return next })
      }
      return s
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit || !session) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/onboarding/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({
          ratings: Object.entries(ratings).map(([id, r]) => ({
            movie_id: Number(id),
            rating: r,
          })),
        }),
      })
      if (!res.ok) throw new Error("Submission failed")
      router.push("/picks")
    } catch {
      setError("Something went wrong — please try again.")
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading films…</p>
  }

  if (error && films.length === 0) {
    return <p className="text-sm text-red-400">{error}</p>
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3">
        <p className="text-sm text-neutral-300">
          {canSubmit
            ? `${ratedCount} films rated — you're good to go. Rate more to improve accuracy.`
            : `Rate ${MIN_RATINGS - ratedCount} more film${MIN_RATINGS - ratedCount !== 1 ? "s" : ""} to build your profile.`}
        </p>
        <p className="text-xs text-neutral-600 mt-1">
          Your recommendations will improve as you rate more films over time.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
        {films.map((film) => (
          <FilmCard
            key={film.id}
            film={film}
            rating={ratings[film.id] ?? null}
            skipped={skipped.has(film.id)}
            onRate={(r) => handleRate(film.id, r)}
            onSkip={() => handleSkip(film.id)}
          />
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Building your profile…" : "Build my profile"}
      </button>
    </div>
  )
}
