"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

type Status = "idle" | "uploading" | "done" | "error"

interface ImportResult {
  ratings_added: number
  watchlist_added: number
  ratings_count: number
  candidates_count: number
}

export function ImportFlow() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const upload = async (file: File) => {
    setStatus("uploading")
    setError(null)
    setResult(null)
    const body = new FormData()
    body.append("file", file)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/import`, {
        method: "POST",
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
      setStatus("error")
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) upload(file)
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
          Import from Letterboxd
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          Go to{" "}
          <a
            href="https://letterboxd.com/settings/data"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
          >
            letterboxd.com/settings/data
          </a>
          , click <span className="text-neutral-300">Export your data</span>, then upload the zip here.
        </p>
      </div>

      {status !== "done" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
            dragging
              ? "border-neutral-400 bg-neutral-800"
              : "border-neutral-700 hover:border-neutral-500"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.csv"
            className="hidden"
            onChange={onFileChange}
          />
          <span className="text-2xl">📦</span>
          <span className="text-sm text-neutral-300">
            {status === "uploading" ? "Importing…" : "Drop zip here or click to choose"}
          </span>
          {status === "uploading" && (
            <span className="text-xs text-neutral-500">
              This may take a minute — enriching films against TMDB
            </span>
          )}
        </div>
      )}

      {status === "done" && result && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 space-y-1">
          <p className="text-sm font-medium text-neutral-200">Import complete</p>
          <p className="text-xs text-neutral-500">
            +{result.ratings_added} ratings · {result.ratings_count} total · {result.candidates_count} candidates
          </p>
          <button
            onClick={() => { setStatus("idle"); setResult(null) }}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors pt-1"
          >
            Import another file
          </button>
        </div>
      )}

      {status === "error" && error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </section>
  )
}
