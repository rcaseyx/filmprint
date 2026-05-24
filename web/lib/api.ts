import { getServerSession } from "next-auth"
import { authOptions } from "./auth"

const API = process.env.NEXT_PUBLIC_API_URL

export async function apiFetch(path: string, options?: RequestInit) {
  const session = await getServerSession(authOptions)
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  }
  if (session?.user?.email) {
    headers["X-User-Email"] = session.user.email
  }
  return fetch(`${API}${path}`, { ...options, headers })
}
