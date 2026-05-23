"use client"

import { useSession, signOut } from "next-auth/react"

export function Header() {
  const { data: session } = useSession()

  if (!session) return null

  return (
    <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
      <span className="font-semibold tracking-tight">filmprint</span>
      <div className="flex items-center gap-4 text-sm text-neutral-400">
        <span>{session.user?.name}</span>
        <button
          onClick={() => signOut()}
          className="hover:text-neutral-100 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
