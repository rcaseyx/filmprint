import React, { createContext, useContext, useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import * as FileSystem from 'expo-file-system'
import { TOKEN_KEY } from '@/lib/api'

interface AuthContextValue {
  token: string | null
  isLoading: boolean
  login: (token: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        const launchFlagUri = FileSystem.documentDirectory + '.launched'
        const launchInfo = await FileSystem.getInfoAsync(launchFlagUri)
        if (!launchInfo.exists) {
          // Fresh install — Keychain persists across reinstalls on iOS, so clear it
          await SecureStore.deleteItemAsync(TOKEN_KEY)
          await FileSystem.writeAsStringAsync(launchFlagUri, '1')
        }
        const stored = await SecureStore.getItemAsync(TOKEN_KEY)
        setToken(stored)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [])

  const login = async (newToken: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, newToken)
    setToken(newToken)
  }

  const logout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    setToken(null)
  }

  return (
    <AuthContext.Provider value={{ token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
