import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'
export const TOKEN_KEY = 'filmprint.token'

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
