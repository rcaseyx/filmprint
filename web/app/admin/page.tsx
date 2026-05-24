import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiFetch } from "@/lib/api"
import { UserTable, type AdminUser } from "./UserTable"

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  const adminEmail = process.env.ADMIN_EMAIL

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/")
  }

  let users: AdminUser[] = []
  try {
    const res = await apiFetch("/api/admin/users", { cache: "no-store" })
    if (res.ok) {
      const data = await res.json()
      users = data.users ?? []
    }
  } catch {
    // API down — render empty table rather than crashing
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-neutral-500 mt-1">{users.length} user{users.length !== 1 ? "s" : ""}</p>
      </div>
      <UserTable initialUsers={users} />
    </div>
  )
}
