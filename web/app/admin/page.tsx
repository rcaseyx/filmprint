import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserTable } from "./UserTable"
import { ThemeManager } from "./ThemeManager"
import { CacheWarmer } from "./CacheWarmer"
import { BetaWhitelist } from "./BetaWhitelist"
import { BetaRequests } from "./BetaRequests"

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  const adminEmail = process.env.ADMIN_EMAIL

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/")
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Beta requests</h2>
        <BetaRequests />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Users</h2>
        <UserTable />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Themes</h2>
        <ThemeManager />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Beta whitelist</h2>
        <BetaWhitelist />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">Cache</h2>
        <CacheWarmer />
      </section>
    </div>
  )
}
