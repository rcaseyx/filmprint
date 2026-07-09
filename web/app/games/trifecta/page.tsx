"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

const API = process.env.NEXT_PUBLIC_API_URL
const TMDB_IMG = "https://image.tmdb.org/t/p/w342"

interface GridMovie {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

interface RevealMovie {
  id: number
  title: string
  rt_score: number
}

interface RevealResult {
  movies: RevealMovie[]
  total: number
  distance: number
  best_distance: number
  is_new_best: boolean
}

export default function TrifectaPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [grid, setGrid] = useState<GridMovie[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [result, setResult] = useState<RevealResult | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [lastRevealedIds, setLastRevealedIds] = useState<number[]>([])

  async function loadGrid(excludeIds: number[] = []) {
    setLoading(true)
    setError(false)
    setSelectedIds([])
    setResult(null)
    try {
      const res = await fetch(
        `${API}/api/games/trifecta/grid?exclude=${excludeIds.join(",")}`,
        { headers: authHeader(session) }
      )
      if (!res.ok) { setError(true); return }
      const data = await res.json()
      setGrid(data.movies)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return
    loadGrid()
  }, [status, session])

  async function selectMovie(movie: GridMovie) {
    if (result || revealing) return
    if (selectedIds.includes(movie.id)) {
      setSelectedIds(selectedIds.filter((id) => id !== movie.id))
      return
    }
    if (selectedIds.length >= 3) return

    const nextSelected = [...selectedIds, movie.id]
    setSelectedIds(nextSelected)

    if (nextSelected.length === 3) {
      setRevealing(true)
      try {
        const res = await fetch(`${API}/api/games/trifecta/reveal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader(session) },
          body: JSON.stringify({ movie_ids: nextSelected }),
        })
        if (res.ok) {
          const data: RevealResult = await res.json()
          setResult(data)
          setLastRevealedIds(nextSelected)
        }
      } finally {
        setRevealing(false)
      }
    }
  }

  if (loading || status === "loading") {
    return <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-500">Loading...</div>
  }

  if (error || grid.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackLink />
        <p className="text-neutral-500 mt-6">Couldn&rsquo;t load a grid — try refreshing.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between">
        <BackLink />
        <button
          onClick={() => loadGrid(result ? lastRevealedIds : [])}
          className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Get a new grid"
        >
          &#8635; New grid
        </button>
      </div>

      <h1 className="text-xl font-semibold text-neutral-100 mt-6">Trifecta</h1>
      <p className="text-neutral-500 text-sm mt-1">
        3 movies, 1 target: hit a combined Rotten Tomatoes score of 150.
      </p>

      <div className="grid grid-cols-3 gap-3 mt-6">
        {grid.map((movie) => {
          const selected = selectedIds.includes(movie.id)
          return (
            <button
              key={movie.id}
              onClick={() => selectMovie(movie)}
              disabled={!!result || revealing}
              className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                selected ? "border-brand" : "border-transparent"
              } disabled:cursor-default`}
            >
              {movie.poster_path ? (
                <Image
                  src={`${TMDB_IMG}${movie.poster_path}`}
                  alt={movie.title}
                  width={160}
                  height={240}
                  className="w-full h-auto object-cover bg-neutral-800"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-neutral-800 flex items-center justify-center text-neutral-600 text-xs text-center p-2">
                  {movie.title}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {revealing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65">
          <Spinner />
        </div>
      )}

      {result && (
        <RevealOverlay result={result} grid={grid} onNewGrid={() => loadGrid(lastRevealedIds)} />
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-8 w-8 text-brand" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function RevealOverlay({ result, grid, onNewGrid }: { result: RevealResult; grid: GridMovie[]; onNewGrid: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const posterById = new Map(grid.map((m) => [m.id, m.poster_path]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-6">
      <div
        className={`w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center transition-all duration-300 ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="flex justify-center gap-3">
          {result.movies.map((m) => {
            const posterPath = posterById.get(m.id)
            return (
              <div key={m.id} className="flex flex-col items-center gap-1.5">
                {posterPath ? (
                  <Image
                    src={`${TMDB_IMG}${posterPath}`}
                    alt={m.title}
                    width={64}
                    height={96}
                    className="rounded-md object-cover bg-neutral-800"
                  />
                ) : (
                  <div className="w-16 h-24 rounded-md bg-neutral-800" />
                )}
                <span className="text-sm font-semibold text-neutral-100">{m.rt_score}%</span>
              </div>
            )
          })}
        </div>
        <p className="text-4xl font-extrabold text-neutral-100 mt-4">{result.total}</p>
        <p className="text-sm text-neutral-500 mt-1">target: 150</p>
        <p className="text-lg font-semibold text-neutral-300 mt-3">
          {result.distance === 0 ? "Exact match! \u{1F3AF}" : `${result.distance} away`}
        </p>
        {result.is_new_best && (
          <p className="text-brand text-sm font-semibold mt-3">New personal best!</p>
        )}
        <p className="text-neutral-500 text-xs mt-2">Personal best: {result.best_distance}</p>
        <button
          onClick={onNewGrid}
          className="mt-6 rounded-xl bg-brand text-neutral-950 font-semibold py-3 px-8 hover:opacity-90 transition-opacity"
        >
          &#8635; New grid
        </button>
        <Link
          href="/games"
          className="block mt-3 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          &larr; Back to Games
        </Link>
      </div>
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
