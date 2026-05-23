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

export function RecommendationHistory({ history }: Props) {
  if (!history.length) {
    return <p className="meta">No recommendations yet — go find your picks.</p>
  }

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 px-6">
      {history.map((entry) => (
        <a
          key={entry.id}
          href={`https://letterboxd.com/tmdb/${entry.movie_id}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 w-[104px] group"
        >
          <div className="relative w-[104px] h-[156px] rounded-lg overflow-hidden bg-neutral-800 mb-2">
            {entry.poster_path ? (
              <Image
                src={`https://image.tmdb.org/t/p/w185${entry.poster_path}`}
                alt={entry.title}
                width={104}
                height={156}
                className="object-cover w-full h-full group-hover:opacity-75 transition-opacity duration-150"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-700 text-xs text-center p-2">
                {entry.title}
              </div>
            )}
            {entry.followed_through && (
              <div className="absolute bottom-0 inset-x-0 bg-neutral-950/80 px-2 py-1.5 text-center">
                {entry.follow_up_rating
                  ? <Stars rating={entry.follow_up_rating} />
                  : <span className="text-xs text-green-500">Watched</span>
                }
              </div>
            )}
          </div>
          <div className="text-xs text-neutral-400 truncate leading-snug">{entry.title}</div>
          <div className="text-xs text-neutral-600">{relativeDate(entry.recommended_at)}</div>
        </a>
      ))}
    </div>
  )
}
