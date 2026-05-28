import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiFetch } from "@/lib/api"
import { UserTable, type AdminUser } from "./UserTable"
import { ThemeManager } from "./ThemeManager"
import { CacheWarmer } from "./CacheWarmer"
import { BetaWhitelist } from "./BetaWhitelist"

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  const adminEmail = process.env.ADMIN_EMAIL

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/")
  }

  const [usersRes, themesRes, whitelistRes] = await Promise.allSettled([
    apiFetch("/api/admin/users", { cache: "no-store" }),
    apiFetch("/api/admin/themes", { cache: "no-store" }),
    apiFetch("/api/admin/whitelist", { cache: "no-store" }),
  ])

  const users: AdminUser[] =
    usersRes.status === "fulfilled" && usersRes.value.ok
      ? (await usersRes.value.json()).users ?? []
      : []

  const themeStats =
    themesRes.status === "fulfilled" && themesRes.value.ok
      ? await themesRes.value.json()
      : { total_keywords: 0, total_themes: 0, multi_keyword_themes: 0 }

  const whitelist: string[] =
    whitelistRes.status === "fulfilled" && whitelistRes.value.ok
      ? (await whitelistRes.value.json()).emails ?? []
      : []

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">
          Users <span className="text-neutral-700 normal-case tracking-normal">({users.length})</span>
        </h2>
        <UserTable initialUsers={users} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Themes</h2>
        <ThemeManager initialStats={themeStats} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">
          Beta whitelist <span className="text-neutral-700 normal-case tracking-normal">({whitelist.length})</span>
        </h2>
        <BetaWhitelist initialEmails={whitelist} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Cache</h2>
        <CacheWarmer />
      </section>
    </div>
  )
}
