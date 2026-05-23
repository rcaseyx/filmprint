import Image from "next/image"

interface HistoryEntry {
  id: number
  movie_id: number
  title: string
  year: number | null
  recommended_at: string | null
  poster_path: string | null
  genres: string[]
  runtime: number | null
  score: number | null
  followed_through: boolean
  follow_up_rating: number | null
  mood_genres: string[]
  mood_tone: string | null
}

interface Props {
  history: HistoryEntry[]
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ""
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 30) return `${diffDays}d ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span className="text-xs text-amber-400 tracking-tight">
      {"★".repeat(full)}
      {half ? "½" : ""}
    </span>
  )
}

export function RecommendationHistory({ history }: Props) {
  if (!history.length) {
    return <p className="text-sm text-neutral-600">No recommendations yet — go find your picks.</p>
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => (
        <div key={entry.id} className="flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-[54px] rounded overflow-hidden bg-neutral-800">
            {entry.poster_path ? (
              <Image
                src={`https://image.tmdb.org/t/p/w92${entry.poster_path}`}
                alt={entry.title}
                width={36}
                height={54}
                className="object-cover w-full h-full"
              />
            ) : (
              <div className="w-full h-full bg-neutral-800" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium truncate">{entry.title}</span>
              <span className="text-xs text-neutral-600 shrink-0">{entry.year}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {entry.mood_genres.slice(0, 2).map((g) => (
                <span key={g} className="text-xs text-neutral-600">{g}</span>
              ))}
              {entry.followed_through && (
                entry.follow_up_rating ? (
                  <Stars rating={entry.follow_up_rating} />
                ) : (
                  <span className="text-xs text-green-700">watched</span>
                )
              )}
            </div>
          </div>
          <span className="text-xs text-neutral-700 shrink-0">{relativeDate(entry.recommended_at)}</span>
        </div>
      ))}
    </div>
  )
}
