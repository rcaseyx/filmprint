"use client"

import { signIn } from "next-auth/react"
import { useState } from "react"
import Link from "next/link"

const API = process.env.NEXT_PUBLIC_API_URL

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || "Something went wrong")
        setLoading(false)
        return
      }
    } catch {
      setError("Could not reach the server")
      setLoading(false)
      return
    }

    await signIn("credentials", { email, password, callbackUrl: "/" })
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">filmprint</h1>
          <p className="text-neutral-400 mt-1 text-sm">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-amber-400 text-neutral-950 rounded-lg font-medium text-sm hover:bg-amber-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
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
