"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { useDebounce } from "@/lib/useDebounce"

const API = process.env.NEXT_PUBLIC_API_URL
const TMDB_IMG = "https://image.tmdb.org/t/p/w342"

interface Round {
  posters: (string | null)[]
}

interface ActorResult {
  person_id: number
  person_name: string
  profile_path: string | null
}

interface RevealResult {
  person_name: string
  movies: { id: number; title: string }[]
  gaveUp: boolean
}

export default function CommonThreadPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [wrongGuess, setWrongGuess] = useState<string | null>(null)
  const [guessing, setGuessing] = useState(false)
  const [result, setResult] = useState<RevealResult | null>(null)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ActorResult[]>([])
  const debouncedQuery = useDebounce(query, 300)

  async function loadRound() {
    setLoading(true)
    setError(false)
    setRound(null)
    setWrongGuess(null)
    setResult(null)
    setQuery("")
    setResults([])
    try {
      const res = await fetch(`${API}/api/games/common-thread/round`, { headers: authHeader(session) })
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
    fetch(`${API}/api/games/common-thread/search-actors?q=${encodeURIComponent(debouncedQuery)}`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setResults(data.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
    return () => { cancelled = true }
  }, [debouncedQuery, result, query, session])

  async function submitGuess(actor: ActorResult) {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await fetch(`${API}/api/games/common-thread/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({ person_id: actor.person_id }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.correct) {
        setResult({ person_name: data.person_name, movies: data.movies, gaveUp: false })
      } else {
        setWrongGuess(`Not ${actor.person_name} — keep looking`)
        setQuery("")
        setResults([])
      }
    } finally {
      setGuessing(false)
    }
  }

  async function giveUp() {
    if (guessing || result) return
    setGuessing(true)
    try {
      const res = await fetch(`${API}/api/games/common-thread/reveal`, { headers: authHeader(session) })
      if (!res.ok) return
      const data = await res.json()
      setResult({ person_name: data.person_name, movies: data.movies, gaveUp: true })
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

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between">
        <BackLink />
        <button
          onClick={loadRound}
          className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Get 3 new posters"
        >
          &#8635; New round
        </button>
      </div>

      <h1 className="text-xl font-semibold text-neutral-100 mt-6">Common Thread</h1>
      <p className="text-neutral-500 text-sm mt-1">One actor connects these 3 movies. Name them.</p>

      <div className="grid grid-cols-3 gap-3 mt-6">
        {round.posters.map((poster, i) => (
          <div key={i} className="rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800">
            {poster ? (
              <Image
                src={`${TMDB_IMG}${poster}`}
                alt="Mystery movie"
                width={160}
                height={240}
                className="w-full h-auto object-cover bg-neutral-800"
              />
            ) : (
              <div className="w-full aspect-[2/3] bg-neutral-800" />
            )}
          </div>
        ))}
      </div>

      {!result && (
        <div className="mt-6">
          <label className="text-sm text-neutral-500">Which actor is in all 3?</label>
          <input
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            placeholder="Actor name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={guessing}
          />
          {wrongGuess && <p className="text-sm text-red-400 mt-1">{wrongGuess}</p>}
          <div className="mt-1">
            {results.map((a) => (
              <button
                key={a.person_id}
                onClick={() => submitGuess(a)}
                disabled={guessing}
                className="block w-full text-left px-3 py-2 rounded-lg text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {a.person_name}
              </button>
            ))}
          </div>
          <button
            onClick={giveUp}
            disabled={guessing}
            className="mt-3 text-sm text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-50"
          >
            Give up &amp; reveal
          </button>
        </div>
      )}

      {result && (
        <div className="mt-6 text-center">
          <p className="text-lg font-semibold text-neutral-100">
            {result.gaveUp ? "It was:" : "Got it!"}
          </p>
          <p className="text-2xl font-extrabold text-brand mt-1">{result.person_name}</p>
          <p className="text-sm text-neutral-500 mt-2">
            {result.movies.map((m) => m.title).join(" • ")}
          </p>
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
