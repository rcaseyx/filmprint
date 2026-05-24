"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { ThemeBreakdown } from "./ThemeBreakdown"

interface ThemeStats {
  total_keywords: number
  total_themes: number
  multi_keyword_themes: number
}

interface ThemeChange {
  from: string
  to: string
  keywords: number
}

export function ThemeManager({ initialStats }: { initialStats: ThemeStats }) {
  const { data: session } = useSession()
  const [stats, setStats] = useState(initialStats)
  const [running, setRunning] = useState<"cleanup" | "recluster" | null>(null)
  const [changes, setChanges] = useState<ThemeChange[] | null>(null)
  const [reclustered, setReclustered] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {}
    if (session?.user?.email) h["X-User-Email"] = session.user.email
    return h
  }

  const refreshStats = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/themes`, { headers: headers() })
      if (res.ok) setStats(await res.json())
    } catch {}
  }

  const runCleanup = async () => {
    setRunning("cleanup")
    setError(null)
    setChanges(null)
    setReclustered(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/cleanup-themes`, {
        method: "POST",
        headers: headers(),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Cleanup failed")
      const data = await res.json()
      setChanges(data.changes)
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed")
    } finally {
      setRunning(null)
    }
  }

  const runRecluster = async () => {
    setRunning("recluster")
    setError(null)
    setChanges(null)
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
      setRunning(null)
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
        <div className="flex items-center gap-2">
          <button
            onClick={runRecluster}
            disabled={running !== null}
            className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === "recluster" ? "Reclustering…" : "Re-cluster"}
          </button>
          <button
            onClick={runCleanup}
            disabled={running !== null}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-700 bg-amber-950/40 text-amber-400 hover:bg-amber-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === "cleanup" ? "Running cleanup…" : "Claude cleanup"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {reclustered !== null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
          <p className="text-sm text-neutral-300">Re-cluster complete — {reclustered} themes discovered</p>
        </div>
      )}

      <ThemeBreakdown />

      {changes !== null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800">
            <p className="text-sm text-neutral-300">
              {changes.length === 0
                ? "No changes — themes look good"
                : `${changes.length} correction${changes.length !== 1 ? "s" : ""} applied`}
            </p>
          </div>
          {changes.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-800/60">
                  <th className="text-left px-4 py-2 text-neutral-500 font-medium">From</th>
                  <th className="text-left px-4 py-2 text-neutral-500 font-medium">To</th>
                  <th className="text-right px-4 py-2 text-neutral-500 font-medium">Keywords</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/40">
                {changes.map((c, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-neutral-500 line-through">{c.from}</td>
                    <td className="px-4 py-2 text-neutral-300">{c.to}</td>
                    <td className="px-4 py-2 text-right text-neutral-600 tabular-nums">{c.keywords}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
