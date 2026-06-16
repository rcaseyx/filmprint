"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { authHeader } from "@/lib/api"

export const REBUILD_PENDING_KEY = "filmprint_rebuild_pending"

interface TopUser {
  username: string
  ratings_count: number
}

interface Props {
  currentUsername?: string | null
}

export function ProfileBuilding({ currentUsername }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const [error, setError] = useState(false)
  const [topUsers, setTopUsers] = useState<TopUser[]>([])

  // Signal RebuildTracker to take over if user navigates away
  useEffect(() => {
    localStorage.setItem(REBUILD_PENDING_KEY, "1")
  }, [])

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/top?limit=6`)
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.users ?? []).filter(
          (u: TopUser) => u.username !== currentUsername
        )
        setTopUsers(filtered.slice(0, 3))
      })
      .catch(() => {})
  }, [currentUsername])

  useEffect(() => {
    if (!session) return

    const poll = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/rebuild/status`, {
          headers: authHeader(session),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.status === "done") {
          localStorage.removeItem(REBUILD_PENDING_KEY)
          router.refresh()
        } else if (data.status === "error") {
          localStorage.removeItem(REBUILD_PENDING_KEY)
          setError(true)
        }
      } catch {
        // transient — keep polling
      }
    }

    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [session, router])

  if (error) {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-red-400">Something went wrong building your profile.</p>
        <Link href="/import" className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors underline underline-offset-2">
          Try importing again
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-10 py-4">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0" />
          <p className="text-sm text-neutral-300">Building your taste profile&hellip;</p>
        </div>
        <p className="text-xs text-neutral-600 pl-5">This takes a minute — feel free to browse while you wait.</p>
      </div>

      {topUsers.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-600">Explore other profiles</p>
          <div className="flex flex-col gap-2">
            {topUsers.map((u) => (
              <Link
                key={u.username}
                href={`/profile/${u.username}`}
                className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 hover:border-neutral-700 transition-colors"
              >
                <span className="text-sm text-neutral-200">{u.username}</span>
                <span className="text-xs text-neutral-500">{u.ratings_count.toLocaleString()} ratings</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
