"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { ThemeBreakdown } from "./ThemeBreakdown"

interface ThemeStats {
  total_keywords: number
  total_themes: number
  multi_keyword_themes: number
}

export function ThemeManager({ initialStats }: { initialStats: ThemeStats }) {
  const { data: session } = useSession()
  const [stats, setStats] = useState(initialStats)
  const [running, setRunning] = useState(false)
  const [reclustered, setReclustered] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const headers = () => authHeader(session)

  const refreshStats = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/themes`, { headers: headers() })
      if (res.ok) setStats(await res.json())
    } catch {}
  }

  const runRecluster = async () => {
    setRunning(true)
    setError(null)
    setReclustered(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/recluster`, {
        method: "POST",
        headers: headers(),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Recluster failed")
      const data = await res.json()
      setReclustered(data.themes)
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recluster failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-neutral-200">Keyword themes</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {stats.total_keywords.toLocaleString()} keywords → {stats.total_themes.toLocaleString()} themes
            {" "}({stats.multi_keyword_themes} multi-keyword)
          </p>
        </div>
        <button
          onClick={runRecluster}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Reclustering…" : "Re-cluster"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {reclustered !== null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
          <p className="text-sm text-neutral-300">Re-cluster complete — {reclustered} themes discovered</p>
        </div>
      )}

      <ThemeBreakdown />
    </div>
  )
}
