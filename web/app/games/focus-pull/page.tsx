"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { useDebounce } from "@/lib/useDebounce"

const API = process.env.NEXT_PUBLIC_API_URL

interface Round {
  poster_path: string | null
  stages: number[]
}

interface MovieResult {
  id: number
  title: string
  year: number | null
}

export default function FocusPullPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [stageIndex, setStageIndex] = useState(0)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [wrongGuess, setWrongGuess] = useState<string | null>(null)
  const [guessing, setGuessing] = useState(false)
  const [result, setResult] = useState<{ title: string; gaveUp: boolean } | null>(null)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MovieResult[]>([])
  const debouncedQuery = useDebounce(query, 300)

  async function loadRound() {
    setLoading(true)
    setError(false)
    setRound(null)
    setStageIndex(0)
    setLoadedSrc(null)
    setWrongGuess(null)
    setResult(null)
    setQuery("")
    setResults([])
    try {
      const res = await fetch(`${API}/api/games/focus-pull/round`, { headers: authHeader(session) })
      if (!res.ok) { setError(true); return }
      setRound(await res.json())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return
    loadRound()
  }, [status, session])

  useEffect(() => {
    setWrongGuess(null)
    if (query.trim().length < 2) setResults([])
  }, [query])

  useEffect(() => {
    if (result || query.trim().length < 2 || debouncedQuery.trim().length < 2) return
    let cancelled = false
    fetch(`${API}/api/games/focus-pull/search-movies?q=${encodeURIComponent(debouncedQuery)}`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
    return () => { cancelled = true }
  }, [debouncedQuery, result, query, session])

  async function submitGuess(movie: MovieResult) {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await fetch(`${API}/api/games/focus-pull/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({ movie_id: movie.id }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.correct) {
        setStageIndex((round?.stages.length ?? 1) - 1)
        setResult({ title: data.title, gaveUp: false })
      } else {
        setWrongGuess(`Not ${movie.title} — take another look`)
        setStageIndex((i) => Math.min(i + 1, (round?.stages.length ?? 1) - 1))
      }
    } finally {
      setGuessing(false)
    }
  }

  async function giveUp() {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await fetch(`${API}/api/games/focus-pull/reveal`, { headers: authHeader(session) })
      if (!res.ok) return
      const data = await res.json()
      setStageIndex((round?.stages.length ?? 1) - 1)
      setResult({ title: data.title, gaveUp: true })
    } finally {
      setGuessing(false)
    }
  }

  if (loading || status === "loading") {
    return <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-500">Loading...</div>
  }

  if (error || !round) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackLink />
        <p className="text-neutral-500 mt-6">Couldn&rsquo;t load a round — try refreshing.</p>
      </div>
    )
  }

  const atFinalStage = stageIndex >= round.stages.length - 1
  const posterSrc = round.poster_path
    ? `${API}/api/games/focus-pull/poster?path=${encodeURIComponent(round.poster_path)}&stage=${stageIndex}`
    : null

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between">
        <BackLink />
        <button
          onClick={loadRound}
          className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Get a new poster"
        >
          &#8635; New round
        </button>
      </div>

      <h1 className="text-xl font-semibold text-neutral-100 mt-6">Focus Pull</h1>
      <p className="text-neutral-500 text-sm mt-1">Name the movie before the whole poster comes into focus.</p>

      <div className="mt-6 flex justify-center">
        <div className="relative w-64 aspect-[2/3] rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800">
          {posterSrc ? (
            <img
              src={posterSrc}
              alt="Mystery poster"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-out"
              style={{ opacity: loadedSrc === posterSrc ? 1 : 0 }}
              onLoad={() => setLoadedSrc(posterSrc)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-neutral-600 text-sm">No poster</div>
          )}
        </div>
      </div>

      {!result && (
        <div className="mt-6">
          <label className="text-sm text-neutral-500">What movie is this?</label>
          <input
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            placeholder="Movie title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={guessing}
          />
          {wrongGuess && <p className="text-sm text-red-400 mt-1">{wrongGuess}</p>}
          <div className="mt-1">
            {results.map((m) => (
              <button
                key={m.id}
                onClick={() => submitGuess(m)}
                disabled={guessing}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {m.title}{m.year ? ` (${m.year})` : ""}
              </button>
            ))}
          </div>
          {atFinalStage && (
            <button
              onClick={giveUp}
              disabled={guessing}
              className="mt-3 text-sm text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-50"
            >
              Give up &amp; reveal
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-6 text-center">
          <p className="text-lg font-semibold text-neutral-100">
            {result.gaveUp ? "It was:" : "Got it!"}
          </p>
          <p className="text-2xl font-extrabold text-brand mt-1">{result.title}</p>
          <button
            onClick={loadRound}
            className="mt-6 w-full rounded-xl bg-brand text-neutral-950 font-semibold py-3 hover:opacity-90 transition-opacity"
          >
            Play again
          </button>
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
