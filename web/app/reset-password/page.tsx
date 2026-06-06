"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

const API = process.env.NEXT_PUBLIC_API_URL

export default function ResetPasswordPage() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token") ?? ""

  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [tokenReason, setTokenReason] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)

  useEffect(() => {
    if (!token) {
      setTokenValid(false)
      setTokenReason("invalid")
      return
    }
    fetch(`${API}/api/auth/password-reset/validate?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        setTokenValid(data.valid)
        setTokenReason(data.reason ?? "")
      })
      .catch(() => {
        setTokenValid(false)
        setTokenReason("invalid")
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8 || !/\d/.test(password)) return
    if (password !== confirm) {
      setError("Passwords don't match")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
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
    setDone(true)
    setTimeout(() => router.push("/login"), 2000)
  }

  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
      </div>
    )
  }

  if (!tokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Link {tokenReason === "expired" ? "expired" : "invalid"}</h1>
          <p className="text-sm text-neutral-400">
            {tokenReason === "expired"
              ? "This reset link has expired."
              : "This reset link is invalid or has already been used."}
          </p>
          <Link href="/forgot-password" className="text-sm text-neutral-300 hover:text-white transition-colors underline underline-offset-2">
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm text-center space-y-2">
          <p className="text-sm text-neutral-300">Password updated. Redirecting to sign in…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">New password</h1>
          <p className="text-neutral-400 mt-1 text-sm">Choose a new password for your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              required
              className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
            />
            {passwordTouched && (password.length < 8 || !/\d/.test(password)) && (
              <p className="text-xs text-red-400 px-1">At least 8 characters including a number</p>
            )}
          </div>
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
            className="w-full py-2.5 bg-brand text-neutral-950 rounded-lg font-medium text-sm hover:bg-amber-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  )
}
