import { getServerSession, Session } from "next-auth"
import { authOptions } from "./auth"

const API = process.env.NEXT_PUBLIC_API_URL

export interface Pick {
  id: number
  title: string
  year: number | string
  source: "watchlist" | "discovered"
  score: number
  match_pct?: number
  reason: string
  poster_path: string | null
  genres: string[]
  runtime: number | null
  streaming: { name: string; logo_path: string }[]
  scores: { imdb: string | null; rt: string | null; metacritic: string | null }
  director?: string
  catalog_film_count?: number
  gap_type?: "country" | "decade"
  gap_label?: string
}

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

async function getSuggestion(path: string, session: Session | null): Promise<Pick | null> {
  const res = await fetch(`${API}${path}`, { headers: authHeader(session) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load suggestion from ${path}`)
  const data = await res.json()
  return data.suggestion as Pick
}

export function getDirectorSuggestion(session: Session | null): Promise<Pick | null> {
  return getSuggestion("/api/picks/director-suggestions", session)
}

export function getBlindSpotSuggestion(session: Session | null): Promise<Pick | null> {
  return getSuggestion("/api/picks/blind-spot-suggestions", session)
}

export function getMoreByDirector(director: string, excludeId: number, session: Session | null): Promise<Pick | null> {
  const params = new URLSearchParams({ director, exclude_id: String(excludeId) })
  return getSuggestion(`/api/picks/director-suggestions/more?${params.toString()}`, session)
}
