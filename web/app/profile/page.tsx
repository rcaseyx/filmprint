import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiFetch } from "@/lib/api"
import { ProfileContent, type ProfileData, type RadarExamples } from "@/components/ProfileContent"

async function getUserStatus() {
  try {
    const res = await apiFetch("/api/user", { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function getProfile(): Promise<ProfileData | null> {
  try {
    const res = await apiFetch("/api/profile", { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function getHistory() {
  try {
    const res = await apiFetch("/api/recommendations/history", { cache: "no-store" })
    const data = await res.json()
    return data.history ?? []
  } catch {
    return []
  }
}

async function getExamples(): Promise<{ genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples }> {
  try {
    const res = await apiFetch("/api/profile/examples", { cache: "no-store" })
    if (!res.ok) return { genre: {}, subgenre: {}, era: {}, tone: {} }
    return res.json()
  } catch {
    return { genre: {}, subgenre: {}, era: {}, tone: {} }
  }
}

export default async function ProfilePage() {
  const [session, user, profile, history, examples] = await Promise.all([
    getServerSession(authOptions),
    getUserStatus(),
    getProfile(),
    getHistory(),
    getExamples(),
  ])

  if (user && !user.has_profile) {
    redirect("/onboarding")
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-400">
        Could not load profile — is the API server running?
      </div>
    )
  }

  const username = user?.username || session?.user?.name || null

  return (
    <ProfileContent
      profile={profile}
      examples={examples}
      history={history}
      username={username}
      isOwner={true}
      hasLetterboxd={!user?.needs_username}
    />
  )
}
