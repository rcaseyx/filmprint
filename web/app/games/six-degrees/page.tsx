"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { useDebounce } from "@/lib/useDebounce"

const API = process.env.NEXT_PUBLIC_API_URL
const TMDB_IMG = "https://image.tmdb.org/t/p/w342"

interface MovieSummary {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface PersonResult {
  person_id: number
  person_name: string
}

interface Hop {
  movie: MovieSummary
  person_name: string
}

interface TodayResponse {
  puzzle_id: number
  start_movie: MovieSummary
  end_movie: MovieSummary
  user_attempt: { is_solved: boolean; degree_count: number | null; solve_time_ms: number | null } | null
}

export default function SixDegreesPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [puzzle, setPuzzle] = useState<TodayResponse | null>(null)

  const [currentMovie, setCurrentMovie] = useState<MovieSummary | null>(null)
  const [visitedIds, setVisitedIds] = useState<number[]>([])
  const [chain, setChain] = useState<Hop[]>([])
  const [guessPath, setGuessPath] = useState<{ movie_id: number; person_id: number; next_movie_id: number }[]>([])
  const startTimeRef = useRef<number>(0)

  const [actorQuery, setActorQuery] = useState("")
  const [actorResults, setActorResults] = useState<PersonResult[]>([])
  const [selectedActor, setSelectedActor] = useState<PersonResult | null>(null)
  const [actorError, setActorError] = useState<string | null>(null)
  const [movieQuery, setMovieQuery] = useState("")
  const [movieResults, setMovieResults] = useState<MovieSummary[]>([])
  const [movieError, setMovieError] = useState<string | null>(null)

  const [solved, setSolved] = useState<{ degree_count: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const debouncedActorQuery = useDebounce(actorQuery, 300)
  const debouncedMovieQuery = useDebounce(movieQuery, 300)

  useEffect(() => {
    if (status !== "authenticated") return
    fetch(`${API}/api/games/six-degrees/today`, { headers: authHeader(session) })
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return }
        const data: TodayResponse = await r.json()
        setPuzzle(data)
        if (!data.user_attempt?.is_solved) {
          setCurrentMovie(data.start_movie)
          setVisitedIds([data.start_movie.id])
          startTimeRef.current = Date.now()
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [status, session])

  // Clear immediately on any state that invalidates in-flight/stale results —
  // debouncedActorQuery lags the visible input by up to 300ms, so relying on
  // it alone to gate "is there a query" briefly re-uses stale text against a
  // newly-current movie (e.g. searching the old actor's name against the new movie's cast).
  useEffect(() => {
    setActorResults([])
    setActorError(null)
  }, [currentMovie?.id, selectedActor, actorQuery])

  useEffect(() => {
    // Guard on both the raw and debounced query: the debounced value lags
    // the visible input by up to 300ms, so right after currentMovie changes
    // (actorQuery already reset to '') the debounced value can still be a
    // leftover non-empty string — without the raw check this fires a real,
    // non-cancelled fetch that re-populates results for a query no longer shown.
    if (selectedActor || actorQuery.trim().length < 2 || debouncedActorQuery.trim().length < 2) return
    let cancelled = false
    fetch(`${API}/api/games/six-degrees/search-people?q=${encodeURIComponent(debouncedActorQuery)}`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setActorResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setActorResults([]) })
    return () => { cancelled = true }
  }, [debouncedActorQuery, selectedActor, actorQuery, session])

  useEffect(() => {
    setMovieResults([])
    setMovieError(null)
  }, [selectedActor, movieQuery])

  useEffect(() => {
    if (!selectedActor || movieQuery.trim().length < 2 || debouncedMovieQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedIds.join(",")
    fetch(
      `${API}/api/games/six-degrees/search-movies?q=${encodeURIComponent(debouncedMovieQuery)}&exclude=${exclude}`,
      { headers: authHeader(session) }
    )
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setMovieResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setMovieResults([]) })
    return () => { cancelled = true }
  }, [debouncedMovieQuery, selectedActor, visitedIds, movieQuery, session])

  async function selectActor(a: PersonResult) {
    if (!currentMovie || verifying) return
    setVerifying(true)
    try {
      const res = await fetch(
        `${API}/api/games/six-degrees/verify-actor?movie_id=${currentMovie.id}&person_id=${a.person_id}`,
        { headers: authHeader(session) }
      )
      const data = await res.json()
      if (data.valid) {
        setSelectedActor(a)
      } else {
        setActorError(`${a.person_name} wasn't in this movie — try again`)
      }
    } finally {
      setVerifying(false)
    }
  }

  async function pickMovie(next: MovieSummary) {
    if (!currentMovie || !selectedActor || !puzzle || verifying) return
    setVerifying(true)
    let valid = false
    try {
      const res = await fetch(
        `${API}/api/games/six-degrees/verify-connection?movie_id=${currentMovie.id}&person_id=${selectedActor.person_id}&next_movie_id=${next.id}`,
        { headers: authHeader(session) }
      )
      valid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!valid) {
      setMovieError(`${selectedActor.person_name} wasn't in ${next.title} — try again`)
      return
    }

    const hop = { movie_id: currentMovie.id, person_id: selectedActor.person_id, next_movie_id: next.id }
    const newGuessPath = [...guessPath, hop]
    const newChain = [...chain, { movie: next, person_name: selectedActor.person_name }]
    setGuessPath(newGuessPath)
    setChain(newChain)
    setVisitedIds((prev) => [...prev, next.id])
    setCurrentMovie(next)
    setSelectedActor(null)
    setActorQuery("")
    setMovieQuery("")
    setActorResults([])
    setMovieResults([])

    if (next.id === puzzle.end_movie.id) {
      setSubmitting(true)
      try {
        const res = await fetch(`${API}/api/games/six-degrees/attempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader(session) },
          body: JSON.stringify({
            puzzle_id: puzzle.puzzle_id,
            guess_path: newGuessPath,
            solve_time_ms: Date.now() - startTimeRef.current,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setSolved({ degree_count: data.degree_count })
        }
      } finally {
        setSubmitting(false)
      }
    }
  }

  if (loading || status === "loading") {
    return <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-500">Loading...</div>
  }

  if (notFound || !puzzle) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackLink />
        <p className="text-neutral-500 mt-6">No puzzle today — check back soon.</p>
      </div>
    )
  }

  const alreadySolved = puzzle.user_attempt?.is_solved
  const degreeCount = solved?.degree_count ?? puzzle.user_attempt?.degree_count

  if (alreadySolved || solved) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackLink />
        <div className="mt-8 text-center">
          <h1 className="text-xl font-semibold text-neutral-100">Solved!</h1>
          <p className="text-neutral-400 mt-2">
            {puzzle.start_movie.title} &rarr; {puzzle.end_movie.title} in {degreeCount} degree{degreeCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <BackLink />

      <div className="flex items-center justify-center gap-6 mt-6">
        <MoviePoster movie={puzzle.start_movie} />
        <span className="text-2xl text-neutral-600">&rarr;</span>
        <MoviePoster movie={puzzle.end_movie} />
      </div>

      {chain.length > 0 && (
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Your chain</div>
          <p className="text-sm text-neutral-300 mt-2 leading-relaxed">
            {puzzle.start_movie.title}
            {chain.map((h, i) => (
              <span key={i}>{"  →  "}{h.person_name}{"  →  "}{h.movie.title}</span>
            ))}
          </p>
        </div>
      )}

      <p className="text-neutral-200 font-medium mt-6">Currently at: {currentMovie?.title}</p>

      {!selectedActor ? (
        <div className="mt-3">
          <label className="text-sm text-neutral-500">Name an actor in this movie</label>
          <input
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            placeholder="Actor name"
            value={actorQuery}
            onChange={(e) => setActorQuery(e.target.value)}
          />
          {actorError && <p className="text-sm text-red-400 mt-1">{actorError}</p>}
          <div className="mt-1">
            {actorResults.map((a) => (
              <button
                key={a.person_id}
                onClick={() => selectActor(a)}
                disabled={verifying}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {a.person_name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-neutral-500">{selectedActor.person_name} was also in...</label>
            <button
              onClick={() => { setSelectedActor(null); setMovieQuery(""); setMovieResults([]) }}
              className="text-sm text-brand hover:underline"
            >
              change
            </button>
          </div>
          <input
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            placeholder="Movie title"
            value={movieQuery}
            onChange={(e) => setMovieQuery(e.target.value)}
          />
          {movieError && <p className="text-sm text-red-400 mt-1">{movieError}</p>}
          <div className="mt-1">
            {movieResults.map((m) => (
              <button
                key={m.id}
                onClick={() => pickMovie(m)}
                disabled={submitting || verifying}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {m.title}{m.year ? ` (${m.year})` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/games" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">
      &larr; Games
    </Link>
  )
}

function MoviePoster({ movie }: { movie: MovieSummary }) {
  return (
    <div className="flex flex-col items-center gap-2 w-32">
      {movie.poster_path ? (
        <Image
          src={`${TMDB_IMG}${movie.poster_path}`}
          alt={movie.title}
          width={110}
          height={165}
          className="rounded-lg object-cover bg-neutral-800"
        />
      ) : (
        <div className="w-[110px] h-[165px] rounded-lg bg-neutral-800 border border-neutral-700" />
      )}
      <p className="text-xs text-neutral-400 text-center">{movie.title}</p>
    </div>
  )
}
