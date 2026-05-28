"use client"

import { useState } from "react"

type Status = "idle" | "loading" | "success" | "error"

export default function SupportPage() {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [issueNumber, setIssueNumber] = useState<number | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("loading")

    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    })

    if (res.ok) {
      const data = await res.json()
      setIssueNumber(data.number)
      setStatus("success")
    } else {
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <p className="text-neutral-100 font-medium">Report filed — thanks.</p>
        <p className="text-neutral-500 text-sm mt-1">
          Tracked as issue #{issueNumber}. We&apos;ll look into it.
        </p>
        <button
          onClick={() => { setTitle(""); setDescription(""); setStatus("idle"); setIssueNumber(null) }}
          className="mt-6 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Submit another
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <h1 className="text-lg font-medium text-neutral-100 mb-1">Report a bug</h1>
      <p className="text-sm text-neutral-500 mb-8">
        Something broken or off? Let us know and we&apos;ll look into it.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="text-sm text-neutral-400">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the issue"
            required
            className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm text-neutral-400">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? What did you expect to happen?"
            required
            rows={6}
            className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors resize-none"
          />
        </div>

        {status === "error" && (
          <p className="text-sm text-red-400">Something went wrong — try again or email rcaseyx@gmail.com.</p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="self-start bg-neutral-100 text-neutral-950 text-sm font-medium px-4 py-2 rounded-md hover:bg-neutral-300 transition-colors disabled:opacity-50"
        >
          {status === "loading" ? "Submitting…" : "Submit report"}
        </button>
      </form>
    </div>
  )
}
