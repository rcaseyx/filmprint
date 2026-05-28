"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"
import { RecommendationResults } from "@/components/RecommendationResults"
import { RecommendationLoader } from "@/components/RecommendationLoader"

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
  genres: string[]
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
      className={`p-4 rounded-xl text-left border transition-all duration-200 ${
        selected
          ? "bg-brand text-neutral-950 border-brand"
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

interface TopFilm {
  id: number
  title: string
  poster_path: string | null
  rating: number
}

export function MoodSelector({ genres }: Props) {
  const { data: session } = useSession()
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [tone, setTone] = useState<Tone | null>(null)
  const [pacing, setPacing] = useState<Pacing | null>(null)
  const [familiarity, setFamiliarity] = useState<Familiarity | null>(null)
  const [runtime, setRuntime] = useState<number | null | "any">("any")
  const [freeText, setFreeText] = useState("")
  const [loading, setLoading] = useState(false)
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [genreExamples, setGenreExamples] = useState<Record<string, TopFilm[]>>({})

  useEffect(() => {
    if (!session) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile/examples`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => setGenreExamples(data.genre as Record<string, TopFilm[]>))
      .catch(() => {})
  }, [session])

  const toggleGenre = (name: string) => {
    setSelectedGenres((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    )
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeader(session) }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/recommendations`, {
        method: "POST",
        headers,
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

  if (loading) {
    return <RecommendationLoader genreExamples={genreExamples} selectedGenres={selectedGenres} />
  }

  if (picks) {
    return <RecommendationResults picks={picks} onReset={handleReset} onRefresh={handleSubmit} refreshing={loading} />
  }

  const chipsDuration = Math.min(genres.length * 35 + 50, 350)

  return (
    <div className="space-y-8">
      <div className="animate-fade-in-up mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">What are you in the mood for?</h1>
        <p className="text-neutral-400 text-sm mt-1">Pick what sounds good and we'll find your best options.</p>
      </div>
      {/* Genre chips — filtered to genres the user has actually rated */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(genreExamples).length > 0
            ? genres.filter((name) => genreExamples[name]?.length > 0)
            : genres
          ).map((name, i) => (
            <button
              key={name}
              onClick={() => toggleGenre(name)}
              style={{ animationDelay: `${i * 35}ms` }}
              className={`animate-fade-in-up px-4 py-2 rounded-full text-sm transition-all duration-150 border active:scale-95 ${
                selectedGenres.includes(name)
                  ? "bg-brand text-neutral-950 border-brand font-medium scale-105"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Vibe grid */}
      <div className="animate-fade-in-up space-y-2" style={{ animationDelay: `${chipsDuration}ms` }}>
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
        style={{ animationDelay: `${chipsDuration + 100}ms` }}
        className="animate-fade-in-up w-full bg-neutral-900/60 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 resize-none"
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{ animationDelay: `${chipsDuration + 180}ms` }}
        className="animate-fade-in-up btn-primary w-full py-3 text-sm"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Finding your picks…
          </span>
        ) : "Find my picks"}
      </button>
    </div>
  )
}
