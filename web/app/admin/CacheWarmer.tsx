"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"

interface CacheStats {
  cache_dir: string
  movie_files: number
  omdb_pending: number
  total_size_mb: number
}

export function CacheWarmer() {
  const { data: session } = useSession()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ movies: number; cache_dir: string } | null>(null)
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {}
    if (session?.user?.email) h["X-User-Email"] = session.user.email
    return h
  }

  const checkStats = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/cache-stats`, { headers: headers() })
      if (res.ok) setStats(await res.json())
    } catch {}
  }

  const run = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/warm-cache`, {
        method: "POST",
        headers: headers(),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed")
      setResult(await res.json())
      setTimeout(checkStats, 5000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-neutral-200">Disk cache</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Pre-populate TMDB and OMDB cache files from the DB. Run once after mounting a persistent volume.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={checkStats}
            className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
          >
            Check stats
          </button>
          <button
            onClick={run}
            disabled={running}
            className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? "Starting…" : "Warm cache"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 space-y-1">
          <p className="text-sm text-neutral-300">Cache warm running in background — {result.movies} movies queued</p>
          <p className="text-xs text-neutral-500 font-mono">{result.cache_dir}</p>
        </div>
      )}

      {stats && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 space-y-1">
          <p className="text-sm text-neutral-300">
            {stats.movie_files} movie files · {stats.omdb_pending} OMDB pending · {stats.total_size_mb} MB
          </p>
          <p className="text-xs text-neutral-500 font-mono">{stats.cache_dir}</p>
        </div>
      )}
    </div>
  )
}
