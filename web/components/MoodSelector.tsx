"use client"

import { useEffect, useRef, useState } from "react"
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

const QUADRANTS = [
  { label: "Cozy",     tone: "light" as Tone, pacing: "slow" as Pacing, cx: "25%", cy: "28%" },
  { label: "Moody",    tone: "dark"  as Tone, pacing: "slow" as Pacing, cx: "75%", cy: "28%" },
  { label: "Playful",  tone: "light" as Tone, pacing: "fast" as Pacing, cx: "25%", cy: "72%" },
  { label: "Intense",  tone: "dark"  as Tone, pacing: "fast" as Pacing, cx: "75%", cy: "72%" },
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
  const canvasRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (!tone && !pacing) setPin(null)
  }, [tone, pacing])

  const getPos = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: Math.max(0.02, Math.min(0.98, (clientX - rect.left) / rect.width)),
      y: Math.max(0.02, Math.min(0.98, (clientY - rect.top) / rect.height)),
    }
  }

  const apply = (pos: { x: number; y: number }) => {
    setPin(pos)
    onChange(pos.x < 0.5 ? "light" : "dark", pos.y < 0.5 ? "slow" : "fast")
  }

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const pos = getPos(e.clientX, e.clientY)
    if (pos) apply(pos)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const pos = getPos(e.clientX, e.clientY)
    if (pos) apply(pos)
  }
  const onMouseUp = () => { dragging.current = false }

  const onTouchStart = (e: React.TouchEvent) => {
    dragging.current = true
    const t = e.touches[0]
    const pos = getPos(t.clientX, t.clientY)
    if (pos) apply(pos)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    const t = e.touches[0]
    const pos = getPos(t.clientX, t.clientY)
    if (pos) apply(pos)
  }
  const onTouchEnd = () => { dragging.current = false }

  const activeQ = pin
    ? QUADRANTS.find((q) => q.tone === (pin.x < 0.5 ? "light" : "dark") && q.pacing === (pin.y < 0.5 ? "slow" : "fast"))
    : null

  return (
    <div className="space-y-2">
      <div
        ref={canvasRef}
        className="relative w-full h-56 rounded-xl bg-neutral-950 border border-neutral-800 cursor-crosshair select-none overflow-hidden touch-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Quadrant dividers */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-neutral-800/70" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-neutral-800/70" />
        </div>

        {/* Axis labels */}
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-neutral-600 uppercase tracking-wider pointer-events-none">Light</span>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-neutral-600 uppercase tracking-wider pointer-events-none">Dark</span>
        <span className="absolute top-2.5 left-1/2 -translate-x-1/2 text-[10px] text-neutral-600 uppercase tracking-wider pointer-events-none">Slow</span>
        <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[10px] text-neutral-600 uppercase tracking-wider pointer-events-none">Fast</span>

        {/* Quadrant labels */}
        {QUADRANTS.map((q) => {
          const isActive = activeQ?.label === q.label
          return (
            <span
              key={q.label}
              className={`absolute text-sm font-medium pointer-events-none transition-colors duration-200 -translate-x-1/2 -translate-y-1/2 ${
                isActive ? "text-neutral-300" : "text-neutral-700"
              }`}
              style={{ left: q.cx, top: q.cy }}
            >
              {q.label}
            </span>
          )
        })}

        {/* Empty hint */}
        {!pin && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-neutral-700">Click or drag to set your vibe</span>
          </div>
        )}

        {/* Pin */}
        {pin && (
          <div
            className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          >
            <div className="w-4 h-4 rounded-full bg-brand shadow-[0_0_12px_3px] shadow-brand/40" />
          </div>
        )}
      </div>

      {/* Clear */}
      {pin && (
        <button
          onClick={() => { setPin(null); onChange(null, null) }}
          className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
        >
          Clear vibe
        </button>
      )}
    </div>
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
        <div className="flex gap-2">
          {([
            { label: "Crowd-pleaser", value: "familiar" as const },
            { label: "Challenging", value: "challenging" as const },
          ]).map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setFamiliarity(familiarity === value ? null : value)}
              className={`px-4 py-2 rounded-full text-sm border transition-all duration-150 active:scale-95 ${
                familiarity === value
                  ? "bg-brand text-neutral-950 border-brand font-medium"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Runtime */}
        <div className="flex gap-2">
          {RUNTIME_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setRuntime(runtime === opt.value ? "any" : opt.value)}
              className={`px-4 py-2 rounded-full text-sm border transition-all duration-150 active:scale-95 ${
                runtime === opt.value
                  ? "bg-brand text-neutral-950 border-brand font-medium"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {opt.label}
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
