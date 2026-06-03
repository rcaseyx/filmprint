import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiFetch } from "@/lib/api"
import { ProfileContent, type ProfileData, type RadarExamples } from "@/components/ProfileContent"
import { MoodSelector } from "@/components/MoodSelector"

const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Family", "Fantasy", "History",
  "Horror", "Music", "Mystery", "Romance", "Science Fiction",
  "Thriller", "War", "Western",
]

const API = process.env.NEXT_PUBLIC_API_URL

async function getPublicProfile(username: string): Promise<ProfileData | null> {
  try {
    const res = await fetch(`${API}/api/users/${encodeURIComponent(username)}`, {
      cache: "no-store",
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function getPublicExamples(username: string): Promise<{ genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples }> {
  try {
    const res = await fetch(`${API}/api/users/${encodeURIComponent(username)}/examples`, {
      cache: "no-store",
    })
    if (!res.ok) return { genre: {}, subgenre: {}, era: {}, tone: {} }
    return res.json()
  } catch {
    return { genre: {}, subgenre: {}, era: {}, tone: {} }
  }
}

async function getPublicHistory(username: string) {
  try {
    const res = await fetch(`${API}/api/users/${encodeURIComponent(username)}/history`, {
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.history ?? []
  } catch {
    return []
  }
}

async function getOwnUsername(): Promise<string | null> {
  try {
    const res = await apiFetch("/api/user", { cache: "no-store" })
    if (!res.ok) return null
    const data = await res.json()
    return data.username || null
  } catch {
    return null
  }
}

interface Props {
  params: Promise<{ username: string }>
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params

  const [profile, examples, history, session] = await Promise.all([
    getPublicProfile(username),
    getPublicExamples(username),
    getPublicHistory(username),
    getServerSession(authOptions),
  ])

  if (!profile) notFound()

  // Redirect to own profile page if viewing yourself
  if (session) {
    const ownUsername = await getOwnUsername()
    if (ownUsername === username) redirect("/profile")
  }

  const showDemo = !session && username === "rcaseyx"

  return (
    <>
      {showDemo && (
        <div className="max-w-2xl mx-auto px-6 pt-12 pb-10">
          <h2 className="text-lg font-semibold tracking-tight mb-1">
            Get picks for {username}&apos;s taste
          </h2>
          <p className="text-neutral-400 text-sm mb-6">
            Pick a mood and genre — filmprint will find films that match both the vibe and {username}&apos;s taste profile.
          </p>
          <MoodSelector genres={GENRES} username={username} />
        </div>
      )}
      <div className={showDemo ? "border-t border-neutral-800" : ""}>
        <ProfileContent
          profile={profile}
          examples={examples}
          history={history}
          username={username}
          isOwner={false}
        />
      </div>
    </>
  )
}
