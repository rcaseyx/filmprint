import { MoodSelector } from "@/components/MoodSelector"

interface Genre {
  name: string
  count: number
  weight: number
}

async function getGenres(): Promise<Genre[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/genres`, {
      cache: "no-store",
    })
    const data = await res.json()
    return data.genres ?? []
  } catch {
    return []
  }
}

export default async function HomePage() {
  const genres = await getGenres()

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <MoodSelector genres={genres} />
    </div>
  )
}
