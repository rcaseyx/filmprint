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
  match_pct?: number
  reason: string
  poster_path: string | null
  genres: string[]
  runtime: number | null
  streaming: { name: string; logo_path: string }[]
  scores: { imdb: string | null; rt: string | null; metacritic: string | null }
}

interface Props {
  genres: string[]
  username?: string
}

type Tone = "light" | "dark"
type Pacing = "slow" | "fast"
type Familiarity = "familiar" | "challenging"

const RUNTIME_OPTIONS: { label: string; sublabel: string; value: number | null }[] = [
  { label: "Short", sublabel: "Under 90 min", value: 90 },
  { label: "Standard", sublabel: "90–120 min", value: 120 },
  { label: "Long", sublabel: "Over 2 hours", value: null },
]

const QUADRANTS = [
  { label: "Cozy",    sub: "feel-good & easygoing",      tone: "light" as Tone, pacing: "slow" as Pacing },
  { label: "Moody",   sub: "atmospheric & introspective", tone: "dark"  as Tone, pacing: "slow" as Pacing },
  { label: "Playful", sub: "fun & lighthearted",          tone: "light" as Tone, pacing: "fast" as Pacing },
  { label: "Intense", sub: "gripping & high-stakes",      tone: "dark"  as Tone, pacing: "fast" as Pacing },
]

function MoodCanvas({
  tone,
  pacing,
  onChange,
}: {
  tone: Tone | null
  pacing: Pacing | null
  onChange: (tone: Tone | null, pacing: Pacing | null) => void
}) {
  return (
    <div className="grid grid-cols-2 rounded-xl border border-neutral-800 overflow-hidden">
        {QUADRANTS.map((q, i) => {
          const selected = q.tone === tone && q.pacing === pacing
          return (
            <button
              key={q.label}
              onClick={() => onChange(selected ? null : q.tone, selected ? null : q.pacing)}
              className={`py-4 text-center transition-colors duration-150 active:scale-95
                ${i % 2 === 1 ? "border-l border-neutral-800" : ""}
                ${i >= 2 ? "border-t border-neutral-800" : ""}
                ${selected ? "bg-brand" : "hover:bg-neutral-900"}`}
            >
              <span className={`block text-sm font-medium ${selected ? "text-neutral-950" : "text-neutral-400"}`}>{q.label}</span>
              <span className={`block text-xs mt-0.5 ${selected ? "text-neutral-800" : "text-neutral-600"}`}>{q.sub}</span>
            </button>
          )
        })}
    </div>
  )
}

interface TopFilm {
  id: number
  title: string
  poster_path: string | null
  rating: number
}

export function MoodSelector({ genres, username }: Props) {
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
    if (username) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${encodeURIComponent(username)}/examples`)
        .then((r) => r.json())
        .then((data) => setGenreExamples(data.genre as Record<string, TopFilm[]>))
        .catch(() => {})
      return
    }
    if (!session) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile/examples`, {
      headers: authHeader(session),
    })
      .then((r) => r.json())
      .then((data) => setGenreExamples(data.genre as Record<string, TopFilm[]>))
      .catch(() => {})
  }, [session, username])

  const toggleGenre = (name: string) => {
    setSelectedGenres((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    )
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = username
        ? `${process.env.NEXT_PUBLIC_API_URL}/api/users/${encodeURIComponent(username)}/recommendations`
        : `${process.env.NEXT_PUBLIC_API_URL}/api/recommendations`
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(!username ? authHeader(session) : {}) }
      const res = await fetch(endpoint, {
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
    return <RecommendationResults picks={picks} onReset={handleReset} onRefresh={username ? undefined : handleSubmit} refreshing={loading} />
  }

  const chipsDuration = Math.min(genres.length * 35 + 50, 350)

  return (
    <div className="space-y-5">
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-semibold tracking-tight">What are you in the mood for?</h1>
        <p className="text-neutral-400 text-sm mt-1">Pick what sounds good and we'll find your best options.</p>
      </div>

      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genres.map((name, i) => (
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

      {/* Mood canvas + familiarity + runtime */}
      <div className="animate-fade-in-up space-y-3" style={{ animationDelay: `${chipsDuration}ms` }}>
        <MoodCanvas
          tone={tone}
          pacing={pacing}
          onChange={(t, p) => { setTone(t); setPacing(p) }}
        />

        {/* Familiarity */}
        <div className="grid grid-cols-2 rounded-xl border border-neutral-800 overflow-hidden">
          {([
            { label: "Crowd-pleaser", sub: "mainstream & accessible", value: "familiar" as const },
            { label: "Challenging", sub: "bold & unconventional", value: "challenging" as const },
          ]).map(({ label, sub, value }, i) => (
            <button
              key={value}
              onClick={() => setFamiliarity(familiarity === value ? null : value)}
              className={`py-3 text-center transition-colors duration-150 ${i > 0 ? "border-l border-neutral-800" : ""} ${
                familiarity === value
                  ? "bg-brand"
                  : "hover:bg-neutral-900"
              }`}
            >
              <span className={`block text-sm font-medium ${familiarity === value ? "text-neutral-950" : "text-neutral-400"}`}>{label}</span>
              <span className={`block text-xs mt-0.5 ${familiarity === value ? "text-neutral-800" : "text-neutral-600"}`}>{sub}</span>
            </button>
          ))}
        </div>

        {/* Runtime */}
        <div className="grid grid-cols-3 rounded-xl border border-neutral-800 overflow-hidden">
          {RUNTIME_OPTIONS.map((opt, i) => (
            <button
              key={opt.label}
              onClick={() => setRuntime(runtime === opt.value ? "any" : opt.value)}
              className={`py-3 text-center transition-colors duration-150 ${i > 0 ? "border-l border-neutral-800" : ""} ${
                runtime === opt.value
                  ? "bg-brand"
                  : "hover:bg-neutral-900"
              }`}
            >
              <span className={`block text-sm font-medium ${runtime === opt.value ? "text-neutral-950" : "text-neutral-400"}`}>{opt.label}</span>
              <span className={`block text-xs mt-0.5 ${runtime === opt.value ? "text-neutral-800" : "text-neutral-600"}`}>{opt.sublabel}</span>
            </button>
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
        Find my picks
      </button>
    </div>
  )
}
