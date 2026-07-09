import { redirect } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

async function getUserStatus() {
  try {
    const res = await apiFetch("/api/user", { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function GamesPage() {
  const user = await getUserStatus()
  if (!user) redirect("/login")

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">Games</h1>
      <p className="text-sm text-neutral-500 mt-1">Movie challenges</p>

      <Link
        href="/games/six-degrees"
        className="block mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-700 transition-colors"
      >
        <h2 className="text-lg font-semibold text-neutral-100">Co-Star</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Connect two actors through shared movies, one hop at a time.
        </p>
      </Link>
    </div>
  )
}
