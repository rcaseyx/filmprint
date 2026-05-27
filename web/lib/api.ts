import { getServerSession, Session } from "next-auth"
import { authOptions } from "./auth"

const API = process.env.NEXT_PUBLIC_API_URL

export async function apiFetch(path: string, options?: RequestInit) {
  const session = await getServerSession(authOptions)
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  }
  if (session?.backendToken) {
    headers["Authorization"] = `Bearer ${session.backendToken}`
  }
  return fetch(`${API}${path}`, { ...options, headers })
}

export function authHeader(session: Session | null): Record<string, string> {
  return session?.backendToken ? { Authorization: `Bearer ${session.backendToken}` } : {}
}
