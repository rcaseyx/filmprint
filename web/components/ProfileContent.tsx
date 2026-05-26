import { RadarSection } from "@/components/RadarSection"
import { ProfileStats } from "@/components/ProfileStats"
import { RecommendationHistory } from "@/components/RecommendationHistory"
import { SyncButton } from "@/components/SyncButton"

export interface Genre {
  name: string
  count: number
  weight: number
}

export interface ToneAxis {
  name: string
  weight: number
}

export interface ProfileData {
  ratings_count: number
  watchlist_count: number
  avg_rating: number
  summary: string
  genres: Genre[]
  decades: ToneAxis[]
  tone: ToneAxis[]
  subgenres: ToneAxis[]
  critic_alignment: number
  quality_floor: number
  neutral: number
}

export interface Example {
  id: number
  title: string
  year: number | null
  rating: number
  poster_path: string | null
}

export type RadarExamples = Record<string, Example[]>

interface Props {
  profile: ProfileData
  examples: { genre: RadarExamples; subgenre: RadarExamples }
  history: unknown[]
  username: string | null
  isOwner: boolean
}

export function ProfileContent({ profile, examples, history, username, isOwner }: Props) {
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
      ? `${isOwner ? "Your" : "Their"} ratings closely match critics`
      : `~${stars.toFixed(1)}★ ${a > 0 ? "above" : "below"} critics on average`

  return (
    <div className="py-12 space-y-10">
      <div className="max-w-2xl mx-auto px-6 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isOwner ? "Your taste profile" : `${username}'s taste profile`}
            </h1>
            <p className="text-neutral-400 text-sm mt-1">
              {isOwner ? (
                <>Built from {profile.ratings_count} Letterboxd ratings</>
              ) : (
                <>
                  {profile.ratings_count} ratings
                  {username && (
                    <>
                      {" · "}
                      <a
                        href={`https://letterboxd.com/${username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-neutral-200 transition-colors"
                      >
                        View on Letterboxd ↗
                      </a>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          {isOwner && <SyncButton />}
        </div>

        <ProfileStats
          ratings={profile.ratings_count}
          watchlist={profile.watchlist_count}
          avgRating={profile.avg_rating}
        />
      </div>

      <div className="max-w-2xl mx-auto px-6 w-full">
        <RadarSection
          genres={topGenres}
          subgenres={profile.subgenres}
          decades={profile.decades}
          tone={profile.tone}
          examples={examples}
        />
      </div>

      <div className="max-w-2xl mx-auto px-6 space-y-10">
        <section>
          <h2 className="label mb-3">Genre affinity</h2>
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
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">{isOwner ? "Your neutral" : "Their neutral"}</div>
            <div className="text-xl font-semibold text-amber-400">{profile.neutral.toFixed(1)}★</div>
            <div className="text-xs text-neutral-600 mt-0.5">Calibrated from your ratings</div>
          </div>
        </section>

        {isOwner && (
          <section>
            <h2 className="label mb-4">Past picks</h2>
            <div className="-mx-6">
              <RecommendationHistory history={history as Parameters<typeof RecommendationHistory>[0]["history"]} />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
