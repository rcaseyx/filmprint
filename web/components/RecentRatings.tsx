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
    <span className="text-xs text-amber-400 tracking-tight">
      {"★".repeat(full)}
      {half ? "½" : ""}
    </span>
  )
}

export function RecentRatings({ ratings }: Props) {
  if (!ratings.length) {
    return <p className="meta">No ratings yet.</p>
  }

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 px-6">
      {ratings.map((film) => (
        <a
          key={`${film.id}-${film.rated_at}`}
          href={`https://letterboxd.com/tmdb/${film.id}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 w-[104px] group"
        >
          <div className="w-[104px] h-[156px] rounded-lg overflow-hidden bg-neutral-800 mb-2">
            {film.poster_path ? (
              <Image
                src={`https://image.tmdb.org/t/p/w185${film.poster_path}`}
                alt={film.title}
                width={104}
                height={156}
                className="object-cover w-full h-full group-hover:opacity-75 transition-opacity duration-150"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-700 text-xs text-center p-2">
                {film.title}
              </div>
            )}
          </div>
          <Stars rating={film.rating} />
          <div className="text-xs text-neutral-400 truncate mt-0.5 leading-snug">{film.title}</div>
          <div className="text-xs text-neutral-600">{film.year}</div>
        </a>
      ))}
    </div>
  )
}
