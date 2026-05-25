import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiFetch } from "@/lib/api"
import { ProfileContent, type ProfileData, type RadarExamples } from "@/components/ProfileContent"

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

async function getPublicExamples(username: string): Promise<{ genre: RadarExamples; subgenre: RadarExamples }> {
  try {
    const res = await fetch(`${API}/api/users/${encodeURIComponent(username)}/examples`, {
      cache: "no-store",
    })
    if (!res.ok) return { genre: {}, subgenre: {} }
    return res.json()
  } catch {
    return { genre: {}, subgenre: {} }
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

  return (
    <ProfileContent
      profile={profile}
      examples={examples}
      history={history}
      username={username}
      isOwner={false}
    />
  )
}
