"use client"

import { useState } from "react"
import { RecommendationResults } from "@/components/RecommendationResults"

interface Genre {
  name: string
  count: number
  weight: number
}

interface Pick {
  id: number
  title: string
  year: number | string
  source: "watchlist" | "discovered"
  score: number
  reason: string
  poster_path: string | null
  genres: string[]
  runtime: number | null
  streaming: { name: string; logo_path: string }[]
  scores: { imdb: string | null; rt: string | null; metacritic: string | null }
}

interface Props {
  genres: Genre[]
}

type Tone = "light" | "dark"
type Pacing = "slow" | "fast"
type Familiarity = "familiar" | "challenging"

const RUNTIME_OPTIONS: { label: string; sublabel: string; value: number | null }[] = [
  { label: "Short", sublabel: "Under 90 min", value: 90 },
  { label: "Standard", sublabel: "90–120 min", value: 120 },
  { label: "Long", sublabel: "Over 2 hours", value: null },
]

function VibeBlock({
  label,
  desc,
  selected,
  onClick,
}: {
  label: string
  desc: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl text-left border transition-colors ${
        selected
          ? "bg-amber-400 text-neutral-950 border-amber-400"
          : "border-neutral-800 hover:bg-neutral-900/60 hover:border-neutral-600"
      }`}
    >
      <div className="font-medium text-sm">{label}</div>
      <div className={`text-xs mt-1 leading-snug ${selected ? "text-neutral-700" : "text-neutral-600"}`}>
        {desc}
      </div>
    </button>
  )
}

export function MoodSelector({ genres }: Props) {
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [tone, setTone] = useState<Tone | null>(null)
  const [pacing, setPacing] = useState<Pacing | null>(null)
  const [familiarity, setFamiliarity] = useState<Familiarity | null>(null)
  const [runtime, setRuntime] = useState<number | null | "any">("any")
  const [freeText, setFreeText] = useState("")
  const [loading, setLoading] = useState(false)
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleGenre = (name: string) => {
    setSelectedGenres((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    )
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          required_genres: selectedGenres,
          exclude_genres: [],
          max_runtime: runtime === "any" ? null : runtime,
          tone,
          pacing,
          familiarity,
          free_text: freeText.trim() || null,
        }),
      })
      if (!res.ok) throw new Error("API error")
      const data = await res.json()
      setPicks(data.picks)
    } catch {
      setError("Something went wrong — is the API server running?")
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setPicks(null)
    setSelectedGenres([])
    setTone(null)
    setPacing(null)
    setFamiliarity(null)
    setRuntime("any")
    setFreeText("")
    setError(null)
  }

  if (picks) {
    return <RecommendationResults picks={picks} onReset={handleReset} />
  }

  return (
    <div className="space-y-8">
      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genres.map((g) => (
            <button
              key={g.name}
              onClick={() => toggleGenre(g.name)}
              className={`px-4 py-2 rounded-full text-sm transition-colors border ${
                selectedGenres.includes(g.name)
                  ? "bg-amber-400 text-neutral-950 border-amber-400 font-medium"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* Vibe grid */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <VibeBlock
            label="Light"
            desc="Feel-good, fun, easy watching"
            selected={tone === "light"}
            onClick={() => setTone(tone === "light" ? null : "light")}
          />
          <VibeBlock
            label="Dark"
            desc="Tense, heavy, or intense"
            selected={tone === "dark"}
            onClick={() => setTone(tone === "dark" ? null : "dark")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <VibeBlock
            label="Slow-burn"
            desc="Patient, layered, atmospheric"
            selected={pacing === "slow"}
            onClick={() => setPacing(pacing === "slow" ? null : "slow")}
          />
          <VibeBlock
            label="Fast-paced"
            desc="Kinetic, plot-driven, propulsive"
            selected={pacing === "fast"}
            onClick={() => setPacing(pacing === "fast" ? null : "fast")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <VibeBlock
            label="Crowd-pleaser"
            desc="Accessible, broadly appealing"
            selected={familiarity === "familiar"}
            onClick={() => setFamiliarity(familiarity === "familiar" ? null : "familiar")}
          />
          <VibeBlock
            label="Challenging"
            desc="Unconventional, bold, demanding"
            selected={familiarity === "challenging"}
            onClick={() => setFamiliarity(familiarity === "challenging" ? null : "challenging")}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RUNTIME_OPTIONS.map((opt) => (
            <VibeBlock
              key={opt.label}
              label={opt.label}
              desc={opt.sublabel}
              selected={runtime === opt.value}
              onClick={() => setRuntime(runtime === opt.value ? "any" : opt.value)}
            />
          ))}
        </div>
      </div>

      {/* Free text */}
      <textarea
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        placeholder="e.g. something set in Japan, or a director I haven't seen before..."
        rows={2}
        className="w-full bg-neutral-900/60 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder-neutral-700 focus:outline-none focus:border-neutral-600 resize-none"
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-amber-400 text-neutral-950 font-semibold text-sm hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Finding your picks..." : "Find my picks"}
      </button>
    </div>
  )
}
