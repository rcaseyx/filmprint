"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

interface SyncResult {
  ratings_count: number
  watchlist_count: number
  rebuild_status?: string
}

interface Props {
  initialHasLetterboxd: boolean
}

export function SyncButton({ initialHasLetterboxd }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const [hasLetterboxd, setHasLetterboxd] = useState(initialHasLetterboxd)
  const [status, setStatus] = useState<"idle" | "syncing" | "updating" | "done" | "error">("idle")
  const [result, setResult] = useState<SyncResult | null>(null)

  useEffect(() => {
    if (!session) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => setHasLetterboxd(!data.needs_username))
      .catch(() => {})
  }, [session])

  const handleSync = async () => {
    setStatus("syncing")
    setResult(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sync`, {
        method: "POST",
        headers: authHeader(session),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setResult(data)
      if (data.rebuild_status === "pending") {
        setStatus("updating")
        const interval = setInterval(async () => {
          try {
            const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/rebuild/status`, {
              headers: authHeader(session),
            })
            if (!r.ok) { clearInterval(interval); setStatus("done"); router.refresh(); return }
            const s = await r.json()
            if (s.status === "done" || s.status === "error") {
              clearInterval(interval)
              setStatus("done")
              router.refresh()
            }
          } catch { /* keep polling */ }
        }, 3000)
      } else {
        setStatus("done")
        router.refresh()
      }
    } catch {
      setStatus("error")
    }
  }

  if (!hasLetterboxd) {
    return (
      <Link href="/connect-letterboxd" className="btn-primary px-4 py-2 text-sm">
        Connect Letterboxd
      </Link>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <button
          onClick={handleSync}
          disabled={status === "syncing" || status === "updating"}
          className="btn-primary px-4 py-2 text-sm"
        >
          {status === "syncing" ? "Syncing..." : status === "updating" ? "Updating..." : "Sync my data"}
        </button>
        <a href="/import" className="hidden sm:block btn-secondary px-4 py-2 text-sm text-center">
          Re-import data
        </a>
      </div>
      <div className="hidden sm:flex flex-col gap-0.5 text-xs text-neutral-500 text-right max-w-[260px]">
        <span>Sync picks up new activity.</span>
        <span>Re-import if your history is out of date.</span>
      </div>
      {status === "updating" && (
        <span className="text-xs text-neutral-500">Updating your profile in background…</span>
      )}
      {status === "done" && (
        <span className="text-xs text-neutral-500">Profile updated</span>
      )}
      {status === "error" && (
        <span className="text-xs text-red-400">Sync failed — is the API running?</span>
      )}
    </div>
  )
}
