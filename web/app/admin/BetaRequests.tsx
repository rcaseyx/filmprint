"use client"

import { useState } from "react"

const API = process.env.NEXT_PUBLIC_API_URL

interface BetaRequest {
  id: number
  name: string
  email: string
  letterboxd_username: string
  ratings_count: number | null
  watchlist_count: number | null
  created_at: string
}

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {}
  const cookies = document.cookie.split(";").reduce<Record<string, string>>((acc, c) => {
    const [k, v] = c.trim().split("=")
    acc[k] = v
    return acc
  }, {})
  const token = cookies["next-auth.session-token"] || cookies["__Secure-next-auth.session-token"] || ""
  return token ? { Cookie: `next-auth.session-token=${token}` } : {}
}

export function BetaRequests({ initialRequests }: { initialRequests: BetaRequest[] }) {
  const [requests, setRequests] = useState(initialRequests)
  const [loading, setLoading] = useState<number | null>(null)

  async function act(id: number, action: "approve" | "deny") {
    setLoading(id)
    try {
      const res = await fetch(`${API}/api/admin/beta-requests/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      })
      if (res.ok) {
        setRequests(r => r.filter(req => req.id !== id))
      }
    } finally {
      setLoading(null)
    }
  }

  if (requests.length === 0) {
    return <p className="text-sm text-neutral-500">No pending requests.</p>
  }

  return (
    <div className="space-y-3">
      {requests.map(req => (
        <div key={req.id} className="flex items-center justify-between gap-4 p-3 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{req.name}</p>
            <p className="text-xs text-neutral-400 truncate">{req.email}</p>
            <p className="text-xs text-neutral-500">
              <span className="text-neutral-300">@{req.letterboxd_username}</span>
              {" · "}
              {req.ratings_count === null
                ? "scraping…"
                : `${req.ratings_count} ratings · ${req.watchlist_count} watchlist`}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => act(req.id, "approve")}
              disabled={loading === req.id}
              className="px-3 py-1.5 text-xs bg-brand text-neutral-950 rounded-md font-medium hover:bg-amber-300 transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => act(req.id, "deny")}
              disabled={loading === req.id}
              className="px-3 py-1.5 text-xs bg-neutral-800 text-neutral-300 rounded-md hover:bg-neutral-700 transition-colors disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
