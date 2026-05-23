import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { SyncButton } from "@/components/SyncButton"
import { GenreRadar } from "@/components/GenreRadar"
import { RecentRatings } from "@/components/RecentRatings"
import { RecommendationHistory } from "@/components/RecommendationHistory"
import { ProfileStats } from "@/components/ProfileStats"

interface Genre {
  name: string
  count: number
  weight: number
}

interface ToneAxis {
  name: string
  weight: number
}

interface ProfileData {
  ratings_count: number
  watchlist_count: number
  avg_rating: number
  summary: string
  genres: Genre[]
  tone: ToneAxis[]
  subgenres: ToneAxis[]
  critic_alignment: number
  quality_floor: number
  neutral: number
}

const API = process.env.NEXT_PUBLIC_API_URL

async function getProfile(): Promise<ProfileData | null> {
  try {
    const res = await fetch(`${API}/api/profile`, { cache: "no-store" })
    return res.json()
  } catch {
    return null
  }
}

async function getRecentRatings() {
  try {
    const res = await fetch(`${API}/api/ratings/recent`, { cache: "no-store" })
    const data = await res.json()
    return data.ratings ?? []
  } catch {
    return []
  }
}

async function getHistory() {
  try {
    const res = await fetch(`${API}/api/recommendations/history`, { cache: "no-store" })
    const data = await res.json()
    return data.history ?? []
  } catch {
    return []
  }
}

export default async function ProfilePage() {
  const [session, profile, recentRatings, history] = await Promise.all([
    getServerSession(authOptions),
    getProfile(),
    getRecentRatings(),
    getHistory(),
  ])

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-400">
        Could not load profile — is the API server running?
      </div>
    )
  }

  const topGenres = profile.genres.slice(0, 8)
  const maxGenreWeight = Math.max(...topGenres.map((g) => g.weight), 0.01)

  const a = profile.critic_alignment
  const stars = Math.abs(a) / 2
  const alignmentLabel =
    a > 2.0 ? "Much more generous than critics" :
    a > 0.75 ? "More generous than critics" :
    a > 0.25 ? "Slightly more generous" :
    a > -0.25 ? "In sync with critics" :
    a > -0.75 ? "Slightly tougher" :
    a > -2.0 ? "Tougher than critics" :
    "Much tougher than critics"
  const alignmentDesc =
    stars < 0.15
      ? "Your ratings closely match critics"
      : `~${stars.toFixed(1)}★ ${a > 0 ? "above" : "below"} critics on average`

  return (
    <div className="py-12 space-y-10">
      {/* Header + Stats: narrow */}
      <div className="max-w-2xl mx-auto px-6 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Your taste profile
            </h1>
            <p className="text-neutral-400 text-sm mt-1">
              Built from {profile.ratings_count} Letterboxd ratings
            </p>
          </div>
          <SyncButton />
        </div>

        <ProfileStats
          ratings={profile.ratings_count}
          watchlist={profile.watchlist_count}
          avgRating={profile.avg_rating}
        />
      </div>

      {/* Radars: wider section */}
      <div className="max-w-3xl mx-auto px-8">
        <div className="grid grid-cols-2 gap-8">
          <GenreRadar data={topGenres} label="Genre" />
          <GenreRadar data={profile.subgenres} label="Sub-genre" />
        </div>
      </div>

      {/* Remaining content: narrow */}
      <div className="max-w-2xl mx-auto px-6 space-y-10">
        {/* Genre detail bars */}
        <section>
          <h2 className="label mb-3">
            Genre affinity
          </h2>
          <div className="space-y-2">
            {topGenres.map((g) => (
              <div key={g.name} className="flex items-center gap-3">
                <span className="text-sm text-neutral-300 w-28 shrink-0">{g.name}</span>
                <div className="flex-1 bg-neutral-800 rounded-full h-1.5">
                  <div
                    className="bg-amber-400 h-1.5 rounded-full genre-bar"
                    style={{ width: `${(g.weight / maxGenreWeight) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-neutral-600 w-8 text-right">{g.count}</span>
              </div>
            ))}
            <p className="text-xs text-neutral-700 mt-1">Bar = taste weight · Count = films rated</p>
          </div>
        </section>

        {/* Critic stats */}
        <section className="grid grid-cols-3 gap-4">
          <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Critic alignment</div>
            <div className="text-sm font-semibold leading-snug">{alignmentLabel}</div>
            <div className="text-xs text-neutral-600 mt-1">{alignmentDesc}</div>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Quality floor</div>
            <div className="text-xl font-semibold">{profile.quality_floor.toFixed(1)}</div>
            <div className="text-xs text-neutral-600 mt-0.5">Min IMDb for candidates</div>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Your neutral</div>
            <div className="text-xl font-semibold text-amber-400">{profile.neutral.toFixed(1)}★</div>
            <div className="text-xs text-neutral-600 mt-0.5">Calibrated from your ratings</div>
          </div>
        </section>

        {/* Recent ratings */}
        <section>
          <h2 className="label mb-4">Recently rated</h2>
          <div className="-mx-6">
            <RecentRatings ratings={recentRatings} />
          </div>
        </section>

        {/* Recommendation history */}
        <section>
          <h2 className="label mb-4">Past picks</h2>
          <div className="-mx-6">
            <RecommendationHistory history={history} />
          </div>
        </section>

      </div>
    </div>
  )
}
