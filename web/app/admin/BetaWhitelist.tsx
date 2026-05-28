"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

const API = process.env.NEXT_PUBLIC_API_URL

export function BetaWhitelist({ initialEmails }: { initialEmails: string[] }) {
  const { data: session } = useSession()
  const [emails, setEmails] = useState(initialEmails)
  const [input, setInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const email = input.trim()
    if (!email) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/whitelist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || "Failed to add")
      }
      const { added } = await res.json()
      setEmails((prev) => [...prev, added])
      setInput("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add")
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(email: string) {
    setRemoving(email)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/whitelist/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: authHeader(session),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || "Failed to remove")
      }
      setEmails((prev) => prev.filter((e) => e !== email))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="email@example.com"
          className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors"
        />
        <button
          type="submit"
          disabled={adding || !input.trim()}
          className="px-4 py-2 bg-neutral-100 text-neutral-950 text-sm font-medium rounded-lg hover:bg-neutral-300 transition-colors disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900">
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-500 font-medium">Email</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60">
            {emails.map((email) => (
              <tr key={email} className="hover:bg-neutral-900/40 transition-colors">
                <td className="px-4 py-3 text-neutral-300">{email}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleRemove(email)}
                    disabled={removing === email}
                    className="text-xs text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {removing === email ? "Removing…" : "Remove"}
                  </button>
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-neutral-600 text-sm">
                  No emails whitelisted
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
