import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PrintLogo } from "@/components/PrintLogo"

const API = process.env.NEXT_PUBLIC_API_URL
const DEMO_USERNAME = "rcaseyx"

interface Genre {
  name: string
  weight: number
}

interface ToneAxis {
  name: string
  weight: number
}

interface DemoProfile {
  ratings_count: number
  avg_rating: number
  critic_alignment: number
  genres: Genre[]
  tone: ToneAxis[]
}

async function getDemoProfile(): Promise<DemoProfile | null> {
  try {
    const res = await fetch(`${API}/api/users/${DEMO_USERNAME}`, { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.round(Math.min(weight, 1) * 100)
  return (
    <div className="h-1 rounded-full bg-neutral-800 overflow-hidden">
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  )
}

function DemoCard({ profile }: { profile: DemoProfile }) {
  const topGenres = profile.genres.slice(0, 4)
  const maxWeight = Math.max(...topGenres.map(g => g.weight), 0.01)
  const topTone = [...profile.tone].sort((a, b) => b.weight - a.weight)[0]?.name ?? null
  const topGenre = topGenres[0]?.name ?? null
  const a = profile.critic_alignment
  const criticLabel =
    a > 1.5 ? "much more generous than critics" :
    a > 0.75 ? "more generous than critics" :
    a > 0.25 ? "slightly more generous than critics" :
    a > -0.25 ? "in sync with critics" :
    a > -0.75 ? "slightly tougher than critics" :
    a > -1.5 ? "tougher than critics" :
    "much tougher than critics"
  const tagline = topTone && topGenre
    ? `Skews ${topTone.toLowerCase()} and ${topGenre.toLowerCase()}-heavy, ${criticLabel}.`
    : null

  return (
    <Link
      href={`/profile/${DEMO_USERNAME}`}
      className="group block rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 hover:border-neutral-600 hover:bg-neutral-900/80 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-sm font-semibold text-brand shrink-0">
            {DEMO_USERNAME[0].toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium text-neutral-100">{DEMO_USERNAME}</div>
            <div className="text-xs text-neutral-500">{profile.ratings_count.toLocaleString()} ratings &middot; avg {profile.avg_rating}★</div>
          </div>
        </div>
        <span className="shrink-0 text-xs px-2 py-1 rounded-full border border-brand/30 text-brand/80 bg-brand/10">
          demo
        </span>
      </div>

      {tagline && (
        <p className="text-sm text-neutral-400 leading-relaxed mb-5">{tagline}</p>
      )}

      <div className="space-y-2.5 mb-5">
        {topGenres.map((g) => (
          <div key={g.name} className="flex items-center gap-3">
            <span className="text-xs text-neutral-400 w-28 shrink-0">{g.name}</span>
            <div className="flex-1">
              <WeightBar weight={g.weight / maxWeight} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-brand/70 group-hover:text-brand transition-colors">
        Explore profile &amp; get picks
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

export default async function HomePage() {
  const [profile, session] = await Promise.all([
    getDemoProfile(),
    getServerSession(authOptions),
  ])

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-16">

      {/* Hero */}
      <div className="flex flex-col items-center gap-4 text-center">
        <PrintLogo className="h-40 w-auto" duration={1} step={0.12} hover={false} />
        <img src="/text_only.svg" alt="filmprint" className="h-14 w-auto" />
        <p className="text-neutral-400 text-sm max-w-xs">
          Personalized picks from your Letterboxd taste
        </p>
        {!session && (
          <div className="flex gap-3 pt-1">
            <Link href="/login" className="btn-primary px-5 py-2 text-sm">
              Sign in
            </Link>
            <Link href="/beta" className="px-5 py-2 text-sm rounded-xl border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 transition-colors">
              Request beta access
            </Link>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="space-y-6">
        <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">How it works</h2>
        <div className="grid gap-4">
          {[
            {
              n: "01",
              title: "Sync your Letterboxd",
              body: "filmprint ingests your full rating history and watchlist — typically thousands of data points — and builds a multi-dimensional taste vector across genre, tone, era, and subgenre axes.",
            },
            {
              n: "02",
              title: "Build a taste profile",
              body: "An ONNX embedding model encodes each film into the same vector space as your taste profile. Films are ranked by cosine similarity, so the candidates closest to your actual preferences surface first.",
            },
            {
              n: "03",
              title: "Pick your mood, get your films",
              body: "Tell filmprint what you're in the mood for — genre, vibe, runtime. It re-ranks candidates against your mood-adjusted taste vector and uses Claude to explain exactly why each pick fits you right now.",
            },
          ].map(({ n, title, body }) => (
            <div key={n} className="flex gap-4">
              <span className="text-xs font-mono text-neutral-600 pt-0.5 shrink-0 w-6">{n}</span>
              <div>
                <div className="text-sm font-medium text-neutral-200 mb-1">{title}</div>
                <p className="text-sm text-neutral-500 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Demo */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Try a live demo</h2>
        <p className="text-sm text-neutral-500">
          See a real taste profile and run recommendations against it — no account needed.
        </p>
        {profile ? (
          <DemoCard profile={profile} />
        ) : (
          <div className="rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-600">
            Demo unavailable right now.
          </div>
        )}
      </div>

    </div>
  )
}
