"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface SyncResult {
  ratings_added: number
  watchlist_added: number
  ratings_count: number
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
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <button
          onClick={handleSync}
          disabled={status === "syncing"}
          className="btn-primary px-4 py-2 text-sm"
        >
          {status === "syncing" ? "Syncing..." : "Sync my data"}
        </button>
        <a href="/import" className="btn-secondary px-4 py-2 text-sm text-center">
          Re-import data
        </a>
      </div>
      {status === "done" && result && (
        <span className="text-xs text-neutral-500">
          {result.ratings_added > 0 || result.watchlist_added > 0
            ? `+${result.ratings_added} ratings · +${result.watchlist_added} watchlist`
            : "Already up to date"}
        </span>
      )}
      {status === "error" && (
        <span className="text-xs text-red-400">Sync failed — is the API running?</span>
      )}
    </div>
  )
}
