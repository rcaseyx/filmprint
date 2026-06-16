"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { authHeader } from "@/lib/api"
import { REBUILD_PENDING_KEY } from "@/components/ProfileBuilding"

export function RebuildTracker() {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackingRef = useRef(false)

  const startPolling = (sess: typeof session) => {
    if (trackingRef.current || !sess) return
    trackingRef.current = true

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/rebuild/status`, {
          headers: authHeader(sess),
        })
        if (!res.ok) {
          // 404 means no job — clear flag and stop
          localStorage.removeItem(REBUILD_PENDING_KEY)
          clearInterval(intervalRef.current!)
          trackingRef.current = false
          return
        }
        const data = await res.json()
        if (data.status === "done") {
          clearInterval(intervalRef.current!)
          trackingRef.current = false
          localStorage.removeItem(REBUILD_PENDING_KEY)
          setReady(true)
          router.refresh()
        } else if (data.status === "error") {
          clearInterval(intervalRef.current!)
          trackingRef.current = false
          localStorage.removeItem(REBUILD_PENDING_KEY)
        }
      } catch {
        // transient — keep polling
      }
    }, 3000)
  }

  // Watch for localStorage flag set by ProfileBuilding when user navigates away
  useEffect(() => {
    if (!session) return
    if (localStorage.getItem(REBUILD_PENDING_KEY) === "1") {
      startPolling(session)
    }
  }, [pathname, session]) // re-check on every navigation

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // Only show the "ready" toast on non-picks pages (ProfileBuilding handles /picks transition)
  if (!ready || pathname === "/picks") return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-brand/30 bg-neutral-900 px-4 py-3 shadow-xl animate-fade-in">
      <span className="text-sm text-neutral-100">Your profile is ready</span>
      <Link
        href="/picks"
        onClick={() => setReady(false)}
        className="text-sm font-medium text-brand hover:text-brand/80 transition-colors"
      >
        View picks →
      </Link>
    </div>
  )
}
