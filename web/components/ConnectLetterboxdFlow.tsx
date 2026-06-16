"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

type Status = "idle" | "submitting" | "done" | "error"

export function ConnectLetterboxdFlow() {
  const router = useRouter()
  const { data: session } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const handleSubmit = async () => {
    if (!username.trim()) {
      setError("Enter your Letterboxd username.")
      return
    }

    setStatus("submitting")
    setError(null)

    try {
      if (file) {
        const body = new FormData()
        body.append("file", file)
        body.append("username", username.trim())
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/import`, {
          method: "POST",
          headers: authHeader(session),
          body,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || "Import failed")
        }
      } else {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/settings/letterboxd`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader(session) },
          body: JSON.stringify({ username: username.trim() }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || "Could not connect account")
        }
      }

      setStatus("done")
      router.push("/picks")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.")
      setStatus("idle")
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
    e.target.value = ""
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setFile(f)
  }

  if (status === "submitting") {
    return (
      <div className="space-y-3 py-4">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0" />
          <p className="text-sm text-neutral-400">Connecting your account…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-neutral-500">
          Letterboxd username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="e.g. rcaseyx"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none transition-colors"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wider text-neutral-500">
            Data export <span className="normal-case text-neutral-600">(optional)</span>
          </label>
          {file && (
            <button
              onClick={() => setFile(null)}
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
            >
              Remove
            </button>
          )}
        </div>

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3">
            <span className="text-base">📦</span>
            <span className="text-sm text-neutral-300 truncate">{file.name}</span>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
              dragging ? "border-neutral-400 bg-neutral-800" : "border-neutral-700 hover:border-neutral-500"
            }`}
          >
            <span className="text-xl">📦</span>
            <span className="text-sm text-neutral-400">Drop your Letterboxd zip here, or click to choose</span>
            <span className="text-xs text-neutral-600">Pulls in your full history — skipped if not provided</span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".zip,.csv"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!username.trim()}
        className="btn-primary w-full py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Connect account
      </button>

      <p className="text-xs text-neutral-600 text-center">
        Without an export, only new activity will sync going forward.
      </p>
    </div>
  )
}
