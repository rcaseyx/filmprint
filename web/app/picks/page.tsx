import { redirect } from "next/navigation"
import { MoodSelector } from "@/components/MoodSelector"
import { ProfileBuilding } from "@/components/ProfileBuilding"
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

export default async function PicksPage() {
  const user = await getUserStatus()

  if (!user) redirect("/login")
  if (user && !user.has_profile && !user.rebuild_in_progress) redirect("/onboarding")

  if (user.rebuild_in_progress) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <ProfileBuilding currentUsername={user.username} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <MoodSelector genres={GENRES} />
    </div>
  )
}
