"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { getDirectorSuggestion, getBlindSpotSuggestion, type Pick } from "@/lib/api"
import { PickCard } from "@/components/PickCard"

type Kind = "director" | "blindspot"
type View = "choice" | "loading" | "suggestion" | "empty" | "error"

const EMPTY_COPY: Record<Kind, string> = {
  director: "You've explored deeply — no new directors to suggest right now.",
  blindspot: "Rate a few more films to unlock this.",
}

const CHOICES: { kind: Kind; label: string; sub: string }[] = [
  { kind: "director", label: "Explore a director", sub: "find your next favorite filmmaker" },
  { kind: "blindspot", label: "Find a blind spot", sub: "films that fit your taste from places you haven't explored" },
]

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export function ExploreSomethingSpecific({ onBack }: { onBack: () => void }) {
  const { data: session } = useSession()
  const [view, setView] = useState<View>("choice")
  const [kind, setKind] = useState<Kind | null>(null)
  const [suggestion, setSuggestion] = useState<Pick | null>(null)

  const fetchSuggestion = async (chosen: Kind) => {
    setKind(chosen)
    setView("loading")
    try {
      const result = chosen === "director"
        ? await getDirectorSuggestion(session)
        : await getBlindSpotSuggestion(session)
      if (!result) {
        setView("empty")
        return
      }
      setSuggestion(result)
      setView("suggestion")
    } catch {
      setView("error")
    }
  }

  if (view === "loading") {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center gap-3 py-16">
        <Spinner />
        <p className="text-sm text-neutral-400">Looking for a hand-picked suggestion…</p>
      </div>
    )
  }

  if (view === "suggestion" && suggestion && kind) {
    const badgeOverride = kind === "director"
      ? `Director: ${suggestion.director}`
      : `Blind spot: ${suggestion.gap_label}`
    return (
      <div className="animate-fade-in space-y-4">
        <PickCard pick={suggestion} badgeOverride={badgeOverride} />
        <div className="flex flex-col gap-3">
          <button onClick={() => fetchSuggestion(kind)} className="btn-primary w-full py-3 text-sm font-medium">
            Show another
          </button>
          <button onClick={onBack} className="btn-secondary w-full py-3 text-sm font-medium">
            ← Back to mood
          </button>
        </div>
      </div>
    )
  }

  if (view === "empty" && kind) {
    return (
      <div className="animate-fade-in space-y-4 text-center py-8">
        <p className="text-neutral-400 text-sm">{EMPTY_COPY[kind]}</p>
        <button onClick={onBack} className="btn-secondary w-full py-3 text-sm font-medium">
          ← Back to mood
        </button>
      </div>
    )
  }

  if (view === "error") {
    return (
      <div className="animate-fade-in space-y-4 text-center py-8">
        <p className="text-red-400 text-sm">Something went wrong — is the API server running?</p>
        <button onClick={onBack} className="btn-secondary w-full py-3 text-sm font-medium">
          ← Back to mood
        </button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up space-y-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hand-picked suggestions</h1>
        <p className="text-neutral-400 text-sm mt-1">Skip the mood check-in — picked from your taste profile directly.</p>
      </div>
      {CHOICES.map(({ kind: k, label, sub }) => (
        <button
          key={k}
          onClick={() => fetchSuggestion(k)}
          className="w-full rounded-xl border border-neutral-800 py-4 text-center hover:bg-neutral-900 transition-colors duration-150 active:scale-95"
        >
          <span className="block text-sm font-medium text-neutral-200">{label}</span>
          <span className="block text-xs mt-0.5 text-neutral-500">{sub}</span>
        </button>
      ))}
      <button onClick={onBack} className="w-full text-center text-sm text-neutral-500 hover:text-neutral-300 pt-1">
        ← Back to mood
      </button>
    </div>
  )
}
