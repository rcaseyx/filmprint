import Image from "next/image"

interface RatedFilm {
  id: number
  title: string
  year: number | null
  rating: number
  rated_at: string | null
  poster_path: string | null
  genres: string[]
  runtime: number | null
}

interface Props {
  ratings: RatedFilm[]
}

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span className="text-xs text-neutral-400 tracking-tight">
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

export function RecentRatings({ ratings }: Props) {
  if (!ratings.length) {
    return <p className="text-sm text-neutral-600">No ratings yet.</p>
  }

  return (
    <div className="space-y-3">
      {ratings.map((film) => (
        <div key={`${film.id}-${film.rated_at}`} className="flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-[54px] rounded overflow-hidden bg-neutral-800">
            {film.poster_path ? (
              <Image
                src={`https://image.tmdb.org/t/p/w92${film.poster_path}`}
                alt={film.title}
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
              <span className="text-sm font-medium truncate">{film.title}</span>
              <span className="text-xs text-neutral-600 shrink-0">{film.year}</span>
            </div>
            <Stars rating={film.rating} />
          </div>
          <span className="text-xs text-neutral-700 shrink-0">{relativeDate(film.rated_at)}</span>
        </div>
      ))}
    </div>
  )
}
