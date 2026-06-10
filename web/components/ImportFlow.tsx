"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

type Status = "idle" | "file_selected" | "uploading" | "done" | "error"

interface ImportResult {
  ratings_added: number
  watchlist_added: number
  ratings_count: number
  candidates_count: number
}

interface Props {
  isOnboarding?: boolean
  needsUsername?: boolean
}

const IMPORT_STEPS = [
  "Reading your export",
  "Enriching films against TMDB",
  "Updating your taste profile",
]
const STEP_DELAYS_MS = [4000, 12000]

export function ImportFlow({ isOnboarding, needsUsername }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [username, setUsername] = useState("")
  const [step, setStep] = useState(0)
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    if (status !== "uploading") return
    setStep(0)
    const timers = STEP_DELAYS_MS.map((delay, i) =>
      setTimeout(() => setStep(i + 1), delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [status])

  useEffect(() => {
    if (status !== "uploading") return
    const interval = setInterval(() => {
      setDotCount((n) => (n % 3) + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [status])

  const upload = async (file: File) => {
    setStatus("uploading")
    setError(null)
    setResult(null)

    const body = new FormData()
    body.append("file", file)
    if (needsUsername && username.trim()) {
      body.append("username", username.trim())
    }

    try {
      const headers = authHeader(session)
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/import`, {
        method: "POST",
        headers,
        body,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || "Upload failed")
      }
      const data = await res.json()
      setResult(data)
      setStatus("done")
      router.refresh()
      if (isOnboarding) {
        router.push("/picks")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
      setStatus("file_selected")
    }
  }

  const selectFile = (file: File) => {
    if (status === "uploading") return
    if (isOnboarding) {
      setPendingFile(file)
      setError(null)
      setStatus("file_selected")
    } else {
      upload(file)
    }
  }

  const handleSubmit = () => {
    if (!username.trim()) {
      setError("Enter your Letterboxd username first.")
      return
    }
    if (!pendingFile) return
    upload(pendingFile)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) selectFile(file)
    e.target.value = ""
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) selectFile(file)
  }

  const importSteps = (
    <div className="flex flex-col gap-3 py-2">
      {IMPORT_STEPS.map((label, i) => {
        const done = i < step
        const active = i === step
        return (
          <div
            key={label}
            className={`flex items-center gap-3 transition-opacity duration-500 ${
              i > step ? "opacity-25" : "opacity-100"
            }`}
          >
            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
              {done ? (
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
                  <circle cx="10" cy="10" r="9" stroke="rgb(251 191 36)" strokeWidth="1.5" />
                  <path d="M6 10l3 3 5-5" stroke="rgb(251 191 36)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : active ? (
                <span className="w-2 h-2 rounded-full bg-brand animate-pulse mx-auto block" />
              ) : (
                <span className="w-2 h-2 rounded-full border border-neutral-700 mx-auto block" />
              )}
            </div>
            <span className={`text-sm ${done ? "text-neutral-500" : active ? "text-neutral-100" : "text-neutral-600"}`}>
              {active ? `${label}${".".repeat(dotCount)}` : label}
            </span>
          </div>
        )
      })}
    </div>
  )

  // Onboarding: step-based loading view
  if (isOnboarding && status === "uploading") {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-neutral-400">Building your taste profile…</p>
        {importSteps}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      {needsUsername && status !== "done" && (
        <div className="space-y-1.5">
          <label className="text-xs uppercase tracking-wider text-neutral-500">
            Letterboxd username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. rcaseyx"
            disabled={status === "uploading"}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none transition-colors disabled:opacity-50"
          />
        </div>
      )}

      {status !== "done" && (
        <>
          {status === "uploading" ? (
            importSteps
          ) : status === "file_selected" && pendingFile ? (
            <div className="flex items-center justify-between rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-base">📦</span>
                <span className="text-sm text-neutral-300 truncate">{pendingFile.name}</span>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors shrink-0 ml-3"
              >
                Change
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
                dragging
                  ? "border-neutral-400 bg-neutral-800 cursor-pointer"
                  : "border-neutral-700 hover:border-neutral-500 cursor-pointer"
              }`}
            >
              <span className="text-2xl">📦</span>
              <span className="text-sm text-neutral-300">
                Drop your Letterboxd zip here, or click to choose
              </span>
              <span className="text-xs text-neutral-600">
                Accepts the .zip from Letterboxd&rsquo;s data export
              </span>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".zip,.csv"
            className="hidden"
            onChange={onFileChange}
          />

          {isOnboarding && (
            <button
              onClick={handleSubmit}
              disabled={!pendingFile || (needsUsername && !username.trim()) || status === "uploading"}
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Build my profile
            </button>
          )}
        </>
      )}

      {status === "done" && result && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 space-y-1">
          <p className="text-sm font-medium text-neutral-200">Import complete</p>
          <p className="text-xs text-neutral-500">
            +{result.ratings_added} ratings · {result.ratings_count} total · {result.candidates_count} candidates ranked
          </p>
          {!isOnboarding && (
            <button
              onClick={() => { setStatus("idle"); setResult(null); setPendingFile(null) }}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors pt-1"
            >
              Import another file
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </section>
  )
}
