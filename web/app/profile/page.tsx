import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { SyncButton } from "@/components/SyncButton"

interface Genre {
  name: string
  count: number
  weight: number
}

interface ProfileData {
  ratings_count: number
  watchlist_count: number
  candidates_count: number
  summary: string
  genres: Genre[]
}

async function getProfile(): Promise<ProfileData | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile`, {
      cache: "no-store",
    })
    return res.json()
  } catch {
    return null
  }
}

export default async function ProfilePage() {
  const [session, profile] = await Promise.all([
    getServerSession(authOptions),
    getProfile(),
  ])

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-400">
        Could not load profile — is the API server running?
      </div>
    )
  }

  const topGenres = profile.genres.slice(0, 8)
  const maxWeight = Math.max(...topGenres.map((g) => g.weight))

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session?.user?.name ?? "Your"} taste profile
          </h1>
          <p className="text-neutral-400 text-sm mt-1">
            Built from {profile.ratings_count} Letterboxd ratings
          </p>
        </div>
        <SyncButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Ratings", value: profile.ratings_count },
          { label: "Watchlist", value: profile.watchlist_count },
          { label: "Candidates", value: profile.candidates_count },
        ].map(({ label, value }) => (
          <div key={label} className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      {/* Genre breakdown */}
      <section>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-4">
          Genre affinity
        </h2>
        <div className="space-y-2">
          {topGenres.map((g) => (
            <div key={g.name} className="flex items-center gap-3">
              <span className="text-sm text-neutral-300 w-28 shrink-0">{g.name}</span>
              <div className="flex-1 bg-neutral-800 rounded-full h-1.5">
                <div
                  className="bg-neutral-100 h-1.5 rounded-full"
                  style={{ width: `${(g.weight / maxWeight) * 100}%` }}
                />
              </div>
              <span className="text-xs text-neutral-600 w-8 text-right">{g.count}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-600 mt-3">Bar = taste weight · Count = films rated</p>
      </section>

      {/* Coming soon */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">Coming soon</h2>
        {[
          { label: "Taste visualization", desc: "Radar chart across genres, decades, and keywords" },
          { label: "Recent ratings", desc: "Your latest Letterboxd activity" },
          { label: "Recommendation history", desc: "What filmprint picked and whether you liked it" },
        ].map(({ label, desc }) => (
          <div key={label} className="border border-neutral-800 rounded-xl p-4 opacity-50">
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
          </div>
        ))}
      </section>
    </div>
  )
}
