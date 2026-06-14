'use client'

import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider } from '@/lib/auth'

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Slot />
    </AuthProvider>
  )
}
