"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface SyncResult {
  ratings_count: number
  watchlist_count: number
  candidates_count: number
}

export function SyncButton() {
  const router = useRouter()
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle")
  const [result, setResult] = useState<SyncResult | null>(null)

  const handleSync = async () => {
    setStatus("syncing")
    setResult(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sync`, {
        method: "POST",
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setResult(data)
      setStatus("done")
      // Refresh server component data (re-fetches /api/profile)
      router.refresh()
    } catch {
      setStatus("error")
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        className="px-4 py-2 text-sm rounded-lg border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {status === "syncing" ? "Syncing..." : "Sync my data"}
      </button>
      {status === "done" && result && (
        <span className="text-xs text-neutral-500">
          Done — {result.ratings_count} ratings · {result.candidates_count} candidates
        </span>
      )}
      {status === "error" && (
        <span className="text-xs text-red-400">Sync failed — is the API running?</span>
      )}
    </div>
  )
}
