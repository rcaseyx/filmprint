"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"

export interface AdminUser {
  id: number
  email: string | null
  letterboxd_username: string | null
  created_at: string
  ratings_count: number
  watchlist_count: number
}

export function UserTable({ initialUsers }: { initialUsers: AdminUser[] }) {
  const { data: session } = useSession()
  const [users, setUsers] = useState(initialUsers)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async (userId: number) => {
    setDeleting(userId)
    setError(null)
    try {
      const headers: Record<string, string> = {}
      if (session?.user?.email) headers["X-User-Email"] = session.user.email
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/users/${userId}`,
        { method: "DELETE", headers }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || "Delete failed")
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900">
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">ID</th>
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Email</th>
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Letterboxd</th>
              <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Ratings</th>
              <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Watchlist</th>
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Joined</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-neutral-900/40 transition-colors">
                <td className="px-4 py-3 text-neutral-600 tabular-nums">{user.id}</td>
                <td className="px-4 py-3 text-neutral-300">{user.email ?? <span className="text-neutral-600">—</span>}</td>
                <td className="px-4 py-3 text-neutral-400">
                  {user.letterboxd_username ? (
                    <span className="inline-flex items-center gap-2">
                      <a
                        href={`/profile/${user.letterboxd_username}`}
                        className="font-mono text-xs hover:text-neutral-200 transition-colors"
                      >
                        {user.letterboxd_username}
                      </a>
                      <a
                        href={`https://letterboxd.com/${user.letterboxd_username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-600 hover:text-neutral-400 transition-colors text-xs"
                        title="View on Letterboxd"
                      >
                        ↗
                      </a>
                    </span>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">{user.ratings_count}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-400">{user.watchlist_count}</td>
                <td className="px-4 py-3 text-neutral-600 text-xs tabular-nums">
                  {user.created_at.slice(0, 10)}
                </td>
                <td className="px-4 py-3 text-right">
                  {confirming === user.id ? (
                    <span className="inline-flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(user.id)}
                        disabled={deleting === user.id}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        {deleting === user.id ? "Deleting…" : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(user.id)}
                      className="text-xs text-neutral-600 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-600 text-sm">
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
