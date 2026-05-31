"use client"

import { useState } from "react"
import Link from "next/link"
import { PrintLogo } from "@/components/PrintLogo"

const API = process.env.NEXT_PUBLIC_API_URL

export default function BetaRequestPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/beta/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, letterboxd_username: username }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || "Something went wrong")
        setLoading(false)
        return
      }
      setSubmitted(true)
    } catch {
      setError("Could not reach the server")
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm space-y-4 text-center">
          <PrintLogo className="h-24 w-auto mx-auto" duration={1} step={0.12} hover={false} />
          <h1 className="text-xl font-semibold tracking-tight">Request received</h1>
          <p className="text-neutral-400 text-sm">
            We&apos;ll review your profile and get back to you soon.
          </p>
          <Link href="/login" className="block text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <PrintLogo className="h-40 w-auto" duration={1} step={0.12} hover={false} />
          <img src="/text_only.svg" alt="filmprint" className="h-14 w-auto mt-0" />
        </div>

        <p className="text-center text-neutral-400 text-sm -mt-4">
          Request access to the filmprint beta
        </p>

        <form onSubmit={handleSubmit} className="space-y-3 -mt-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          <input
            type="text"
            placeholder="Letterboxd username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-brand text-neutral-950 rounded-lg font-medium text-sm hover:bg-amber-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Submitting…" : "Request access"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="text-neutral-300 hover:text-white transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
