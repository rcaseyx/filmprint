import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'
export const TOKEN_KEY = 'filmprint.token'

export interface Pick {
  id: number
  title: string
  year: number | string
  source: 'watchlist' | 'discovered'
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
  gap_type?: 'country' | 'decade'
  gap_label?: string
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY)
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined ?? {}),
    },
  })
}

async function getSuggestion(path: string): Promise<Pick | null> {
  const res = await apiFetch(path)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load suggestion from ${path}`)
  const data = await res.json()
  return data.suggestion as Pick
}

export function getDirectorSuggestion(): Promise<Pick | null> {
  return getSuggestion('/api/picks/director-suggestions')
}

export function getBlindSpotSuggestion(): Promise<Pick | null> {
  return getSuggestion('/api/picks/blind-spot-suggestions')
}

export function getMoreByDirector(director: string, excludeId: number): Promise<Pick | null> {
  const params = new URLSearchParams({ director, exclude_id: String(excludeId) })
  return getSuggestion(`/api/picks/director-suggestions/more?${params.toString()}`)
}
