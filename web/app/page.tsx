import { redirect } from "next/navigation"
import { MoodSelector } from "@/components/MoodSelector"
import { apiFetch } from "@/lib/api"

const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Family", "Fantasy", "History",
  "Horror", "Music", "Mystery", "Romance", "Science Fiction",
  "Thriller", "War", "Western",
]

async function getUserStatus() {
  try {
    const res = await apiFetch("/api/user", { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function HomePage() {
  const user = await getUserStatus()

  if (user && !user.has_profile) {
    redirect("/onboarding")
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <MoodSelector genres={GENRES} />
    </div>
  )
}
