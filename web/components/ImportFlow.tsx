"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"

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
      const headers: Record<string, string> = {}
      if (session?.user?.email) {
        headers["X-User-Email"] = session.user.email
      }
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
        router.push("/")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
      setStatus("file_selected")
    }
  }

  const selectFile = (file: File) => {
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

  // Onboarding: building profile spinner
  if (isOnboarding && status === "uploading") {
    return (
      <div className="flex flex-col items-center gap-5 py-12">
        <div className="h-10 w-10 rounded-full border-2 border-neutral-700 border-t-amber-400 animate-spin" />
        <div className="text-center space-y-1">
          <p className="text-sm text-neutral-300">Building your taste profile…</p>
          <p className="text-xs text-neutral-500">This may take a minute — enriching your films against TMDB</p>
        </div>
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
          {status === "file_selected" && pendingFile ? (
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
              className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors ${
                dragging
                  ? "border-neutral-400 bg-neutral-800"
                  : "border-neutral-700 hover:border-neutral-500"
              }`}
            >
              <span className="text-2xl">📦</span>
              <span className="text-sm text-neutral-300">
                {status === "uploading" ? "Importing…" : "Drop your Letterboxd zip here, or click to choose"}
              </span>
              {status === "uploading" ? (
                <span className="text-xs text-neutral-500">
                  This may take a minute — enriching films against TMDB
                </span>
              ) : (
                <span className="text-xs text-neutral-600">
                  Accepts the .zip from Letterboxd&rsquo;s data export
                </span>
              )}
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
