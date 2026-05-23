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
}

interface Props {
  genres: Genre[]
}

type Tone = "light" | "dark"
type Pacing = "slow" | "fast"
type Familiarity = "familiar" | "challenging"

const RUNTIME_OPTIONS = [
  { label: "Short", sublabel: "< 90 min", value: 90 },
  { label: "Standard", sublabel: "90–120 min", value: 120 },
  { label: "Long", sublabel: "120+ min", value: null },
]

function Toggle<T extends string>({
  left, right, value, onChange,
}: {
  left: { label: string; value: T }
  right: { label: string; value: T }
  value: T | null
  onChange: (v: T | null) => void
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-neutral-800">
      {[left, right].map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(value === opt.value ? null : opt.value)}
          className={`flex-1 px-4 py-2 text-sm transition-colors ${
            value === opt.value
              ? "bg-neutral-100 text-neutral-900 font-medium"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
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

  if (picks) {
    return <RecommendationResults picks={picks} onReset={() => setPicks(null)} />
  }

  return (
    <div className="space-y-8">
      {/* Genre chips */}
      {genres.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Genres</h2>
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g.name}
                onClick={() => toggleGenre(g.name)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors border ${
                  selectedGenres.includes(g.name)
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100 font-medium"
                    : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Mood toggles */}
      <section>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Mood</h2>
        <div className="space-y-2">
          <Toggle<Tone>
            left={{ label: "Light", value: "light" }}
            right={{ label: "Dark", value: "dark" }}
            value={tone}
            onChange={setTone}
          />
          <Toggle<Pacing>
            left={{ label: "Slow-burn", value: "slow" }}
            right={{ label: "Fast-paced", value: "fast" }}
            value={pacing}
            onChange={setPacing}
          />
          <Toggle<Familiarity>
            left={{ label: "Familiar", value: "familiar" }}
            right={{ label: "Challenging", value: "challenging" }}
            value={familiarity}
            onChange={setFamiliarity}
          />
        </div>
      </section>

      {/* Runtime */}
      <section>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Runtime</h2>
        <div className="flex gap-2">
          {RUNTIME_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setRuntime(runtime === opt.value ? "any" : opt.value)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm border transition-colors text-center ${
                runtime === opt.value
                  ? "bg-neutral-100 text-neutral-900 border-neutral-100 font-medium"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              <div>{opt.label}</div>
              <div className="text-xs opacity-60">{opt.sublabel}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Free text */}
      <section>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Anything else?</h2>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="e.g. something set in Japan, or a director I haven't seen before..."
          rows={2}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
        />
      </section>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-neutral-100 text-neutral-900 font-medium text-sm hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Finding your picks..." : "Find my picks"}
      </button>
    </div>
  )
}
