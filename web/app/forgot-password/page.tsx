"use client"

import { useState } from "react"
import Link from "next/link"

const API = process.env.NEXT_PUBLIC_API_URL

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await fetch(`${API}/api/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "" }),
      })
    } catch {
      // swallow — always show the same confirmation
    }
    setLoading(false)
    setSubmitted(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
          {!submitted && <p className="text-neutral-400 mt-1 text-sm">Enter the email you signed up with</p>}
        </div>

        {submitted ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-300 text-center">
              If an account with that email exists, you'll receive a reset link shortly.
            </p>
            <p className="text-center">
              <Link href="/login" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-brand text-neutral-950 rounded-lg font-medium text-sm hover:bg-amber-300 transition-colors disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center">
              <Link href="/login" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
