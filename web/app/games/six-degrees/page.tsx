"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { useDebounce } from "@/lib/useDebounce"
import { Avatar } from "@/components/Avatar"

const API = process.env.NEXT_PUBLIC_API_URL
const TMDB_IMG = "https://image.tmdb.org/t/p/w185"

interface PersonSummary {
  id: number
  name: string
  profile_path: string | null
}

interface PersonResult {
  person_id: number
  person_name: string
  profile_path: string | null
}

interface MovieSummary {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface Hop {
  movie: MovieSummary
  person: PersonResult
}

interface TodayResponse {
  puzzle_id: number
  start_person: PersonSummary
  end_person: PersonSummary
  user_attempt: { is_solved: boolean; degree_count: number | null; solve_time_ms: number | null } | null
}

export default function SixDegreesPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [puzzle, setPuzzle] = useState<TodayResponse | null>(null)

  const [currentPerson, setCurrentPerson] = useState<PersonResult | null>(null)
  const [visitedMovieIds, setVisitedMovieIds] = useState<number[]>([])
  const [visitedPersonIds, setVisitedPersonIds] = useState<number[]>([])
  const [chain, setChain] = useState<Hop[]>([])
  const [guessPath, setGuessPath] = useState<{ person_id: number; movie_id: number; next_person_id: number }[]>([])
  const startTimeRef = useRef<number>(0)

  const [movieQuery, setMovieQuery] = useState("")
  const [movieResults, setMovieResults] = useState<MovieSummary[]>([])
  const [selectedMovie, setSelectedMovie] = useState<MovieSummary | null>(null)
  const [movieError, setMovieError] = useState<string | null>(null)
  const [actorQuery, setActorQuery] = useState("")
  const [actorResults, setActorResults] = useState<PersonResult[]>([])
  const [actorError, setActorError] = useState<string | null>(null)

  const [solved, setSolved] = useState<{ degree_count: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const debouncedMovieQuery = useDebounce(movieQuery, 300)
  const debouncedActorQuery = useDebounce(actorQuery, 300)

  useEffect(() => {
    if (status !== "authenticated") return
    fetch(`${API}/api/games/six-degrees/today`, { headers: authHeader(session) })
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return }
        const data: TodayResponse = await r.json()
        setPuzzle(data)
        if (!data.user_attempt?.is_solved) {
          setCurrentPerson({
            person_id: data.start_person.id,
            person_name: data.start_person.name,
            profile_path: data.start_person.profile_path,
          })
          setVisitedPersonIds([data.start_person.id])
          startTimeRef.current = Date.now()
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [status, session])

  // Clear immediately on any state that invalidates in-flight/stale results —
  // debouncedMovieQuery lags the visible input by up to 300ms, so relying on
  // it alone to gate "is there a query" briefly re-uses stale text against a
  // newly-current actor (e.g. searching the old movie title against the new actor).
  useEffect(() => {
    setMovieResults([])
    setMovieError(null)
  }, [currentPerson?.person_id, selectedMovie, movieQuery])

  useEffect(() => {
    if (!currentPerson || selectedMovie || movieQuery.trim().length < 2 || debouncedMovieQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedMovieIds.join(",")
    fetch(
      `${API}/api/games/six-degrees/search-movies?q=${encodeURIComponent(debouncedMovieQuery)}&exclude=${exclude}`,
      { headers: authHeader(session) }
    )
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setMovieResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setMovieResults([]) })
    return () => { cancelled = true }
  }, [debouncedMovieQuery, currentPerson, selectedMovie, movieQuery, visitedMovieIds, session])

  useEffect(() => {
    setActorResults([])
    setActorError(null)
  }, [selectedMovie, actorQuery])

  useEffect(() => {
    if (!selectedMovie || actorQuery.trim().length < 2 || debouncedActorQuery.trim().length < 2) return
    let cancelled = false
    const exclude = visitedPersonIds.join(",")
    fetch(`${API}/api/games/six-degrees/search-people?q=${encodeURIComponent(debouncedActorQuery)}&exclude=${exclude}`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setActorResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setActorResults([]) })
    return () => { cancelled = true }
  }, [debouncedActorQuery, selectedMovie, actorQuery, visitedPersonIds, session])

  // Verifies next connects to currentPerson via movie, and if so records the hop
  // and advances (submitting the attempt if next is the target). Returns whether
  // it succeeded. silent suppresses the error message -- used for the "does this
  // movie already reach the target?" speculative check in selectMovie, where a
  // false result just means "keep going," not a real wrong guess.
  async function tryAdvance(movie: MovieSummary, next: PersonResult, silent = false): Promise<boolean> {
    if (!currentPerson || !puzzle || verifying) return false
    setVerifying(true)
    let valid = false
    try {
      const res = await fetch(
        `${API}/api/games/six-degrees/verify-shared-movie?movie_id=${movie.id}&person_id=${currentPerson.person_id}&next_person_id=${next.person_id}`,
        { headers: authHeader(session) }
      )
      valid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!valid) {
      if (!silent) setActorError(`${next.person_name} wasn't in ${movie.title} — try again`)
      return false
    }

    const hop = { person_id: currentPerson.person_id, movie_id: movie.id, next_person_id: next.person_id }
    const newGuessPath = [...guessPath, hop]
    const newChain = [...chain, { movie, person: next }]
    setGuessPath(newGuessPath)
    setChain(newChain)

    if (next.person_id === puzzle.end_person.id) {
      // Don't advance currentPerson/reset the input UI here -- that would
      // briefly render "Currently at: {target}" while the attempt is still
      // submitting. Leave the in-progress view as-is and jump straight from
      // "submitting" to the solved screen once we hear back.
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
      return true
    }

    setVisitedMovieIds((prev) => [...prev, movie.id])
    setVisitedPersonIds((prev) => [...prev, next.person_id])
    setCurrentPerson(next)
    setSelectedMovie(null)
    setMovieQuery("")
    setActorQuery("")
    setMovieResults([])
    setActorResults([])
    return true
  }

  async function selectMovie(m: MovieSummary) {
    if (!currentPerson || !puzzle || verifying) return
    setVerifying(true)
    let actorValid = false
    try {
      const res = await fetch(
        `${API}/api/games/six-degrees/verify-actor?movie_id=${m.id}&person_id=${currentPerson.person_id}`,
        { headers: authHeader(session) }
      )
      actorValid = (await res.json()).valid
    } finally {
      setVerifying(false)
    }
    if (!actorValid) {
      setMovieError(`${currentPerson.person_name} wasn't in ${m.title} — try again`)
      return
    }

    // If the target actor was also in this movie, finish immediately rather
    // than making the player type out the name they're already trying to reach.
    const target: PersonResult = {
      person_id: puzzle.end_person.id,
      person_name: puzzle.end_person.name,
      profile_path: puzzle.end_person.profile_path,
    }
    const reachedTarget = await tryAdvance(m, target, true)
    if (reachedTarget) return

    setSelectedMovie(m)
  }

  async function pickActor(next: PersonResult) {
    if (!selectedMovie) return
    await tryAdvance(selectedMovie, next)
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
            {degreeCount} degree{degreeCount === 1 ? "" : "s"}
          </p>
        </div>
        {chain.length > 0 ? (
          <ChainTimeline startPerson={puzzle.start_person} chain={chain} />
        ) : (
          <div className="flex items-center justify-center gap-6 mt-6">
            <Headshot person={puzzle.start_person} />
            <span className="text-2xl text-neutral-600">&rarr;</span>
            <Headshot person={puzzle.end_person} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <BackLink />

      <div className="flex items-center justify-center gap-6 mt-6">
        <Headshot person={puzzle.start_person} />
        <span className="text-2xl text-neutral-600">&rarr;</span>
        <Headshot person={puzzle.end_person} />
      </div>

      {chain.length > 0 && <ChainTimeline startPerson={puzzle.start_person} chain={chain} />}

      <p className="text-neutral-200 font-medium mt-6">Currently at: {currentPerson?.person_name}</p>

      {!selectedMovie ? (
        <div className="mt-3">
          <label className="text-sm text-neutral-500">Name a movie they were in</label>
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
                onClick={() => selectMovie(m)}
                disabled={verifying}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {m.title}{m.year ? ` (${m.year})` : ""}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            {selectedMovie.poster_path ? (
              <Image
                src={`${TMDB_IMG.replace("w185", "w92")}${selectedMovie.poster_path}`}
                alt={selectedMovie.title}
                width={40}
                height={60}
                className="rounded object-cover bg-neutral-800"
              />
            ) : (
              <div className="w-10 h-[60px] rounded bg-neutral-800 border border-neutral-700" />
            )}
            <div className="flex-1">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">Selected movie</div>
              <div className="text-sm font-semibold text-neutral-100">
                {selectedMovie.title}{selectedMovie.year ? ` (${selectedMovie.year})` : ""}
              </div>
            </div>
            <button
              onClick={() => { setSelectedMovie(null); setActorQuery(""); setActorResults([]) }}
              className="text-sm text-brand hover:underline"
            >
              change
            </button>
          </div>

          <label className="text-sm text-neutral-500 mt-3 block">Name another actor in this movie</label>
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
                onClick={() => pickActor(a)}
                disabled={submitting || verifying}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {a.person_name}
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

type ChainEntry =
  | { kind: "person"; name: string; profile_path: string | null }
  | { kind: "movie"; title: string; poster_path: string | null }

function buildChainEntries(startPerson: PersonSummary, chain: Hop[]): ChainEntry[] {
  const entries: ChainEntry[] = [{ kind: "person", name: startPerson.name, profile_path: startPerson.profile_path }]
  for (const h of chain) {
    entries.push({ kind: "movie", title: h.movie.title, poster_path: h.movie.poster_path })
    entries.push({ kind: "person", name: h.person.person_name, profile_path: h.person.profile_path })
  }
  return entries
}

function ChainTimeline({ startPerson, chain }: { startPerson: PersonSummary; chain: Hop[] }) {
  const entries = buildChainEntries(startPerson, chain)
  return (
    <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Your chain</div>
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-3 mt-3">
          <span className="w-6 h-6 shrink-0 rounded-full bg-neutral-800 text-neutral-400 text-xs font-semibold flex items-center justify-center">
            {i + 1}
          </span>
          {e.kind === "person" ? (
            e.profile_path ? (
              <Image
                src={`${TMDB_IMG}${e.profile_path}`}
                alt={e.name}
                width={28}
                height={28}
                className="rounded-full object-cover bg-neutral-800"
              />
            ) : (
              <Avatar name={e.name} size={28} />
            )
          ) : e.poster_path ? (
            <Image
              src={`${TMDB_IMG.replace("w185", "w92")}${e.poster_path}`}
              alt={e.title}
              width={32}
              height={48}
              className="rounded object-cover bg-neutral-800"
            />
          ) : (
            <div className="w-8 h-12 rounded bg-neutral-800 border border-neutral-700" />
          )}
          <span className={e.kind === "person" ? "text-sm font-medium text-neutral-100" : "text-sm text-neutral-500 italic"}>
            {e.kind === "person" ? e.name : e.title}
          </span>
        </div>
      ))}
    </div>
  )
}

function Headshot({ person }: { person: PersonSummary }) {
  return (
    <div className="flex flex-col items-center gap-2 w-32">
      {person.profile_path ? (
        <Image
          src={`${TMDB_IMG}${person.profile_path}`}
          alt={person.name}
          width={110}
          height={165}
          className="rounded-lg object-cover bg-neutral-800"
        />
      ) : (
        <div className="w-[110px] h-[165px] rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center">
          <Avatar name={person.name} size={56} />
        </div>
      )}
      <p className="text-xs text-neutral-400 text-center">{person.name}</p>
    </div>
  )
}
