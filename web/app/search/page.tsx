"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import { useDebounce } from "@/lib/useDebounce"

const API = process.env.NEXT_PUBLIC_API_URL

interface UserResult {
  id: number
  letterboxd_username: string | null
  display_name: string | null
  ratings_count: number
}

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    fetch(`${API}/api/users/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((data) => setResults(data.users ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debouncedQuery])

  return (
    <div className="max-w-xl mx-auto px-6 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find a user</h1>
        <p className="text-neutral-400 text-sm mt-1">Search by username</p>
      </div>

      <input
        type="text"
        placeholder="Username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
      />

      {!loading && query && results.length === 0 && (
        <p className="text-sm text-neutral-500">No filmprint users found for &ldquo;{query}&rdquo;</p>
      )}

      {results.length > 0 && (
        <ul className={`space-y-1 transition-opacity duration-150 ${loading ? "opacity-40" : "opacity-100"}`}>
          {results.map((user) => {
            const name = user.letterboxd_username ?? user.display_name ?? "Unknown"
            const inner = (
              <>
                <Avatar name={name} size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-200 group-hover:text-white transition-colors">
                    {name}
                  </div>
                  <div className="text-xs text-neutral-600">{user.ratings_count} ratings</div>
                </div>
              </>
            )
            return (
              <li key={user.id}>
                {user.letterboxd_username ? (
                  <Link
                    href={`/profile/${user.letterboxd_username}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-900 transition-colors group"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
                    {inner}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
