import { redirect } from "next/navigation"
import { MoodSelector } from "@/components/MoodSelector"
import { apiFetch } from "@/lib/api"

interface Genre {
  name: string
  count: number
  weight: number
}

async function getUserStatus() {
  try {
    const res = await apiFetch("/api/user", { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function getGenres(): Promise<Genre[]> {
  try {
    const res = await apiFetch("/api/genres", { cache: "no-store" })
    const data = await res.json()
    return data.genres ?? []
  } catch {
    return []
  }
}

export default async function HomePage() {
  const user = await getUserStatus()

  if (user && !user.has_profile) {
    redirect("/onboarding")
  }

  const genres = await getGenres()

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <MoodSelector genres={genres} />
    </div>
  )
}
