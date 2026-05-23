"use client"

import Link from "next/link"
import { useSession, signOut } from "next-auth/react"

export function Header() {
  const { data: session } = useSession()

  if (!session) return null

  return (
    <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight hover:text-neutral-300 transition-colors">
          filmprint
        </Link>
        <nav className="flex items-center gap-4 text-sm text-neutral-400">
          <Link href="/" className="hover:text-neutral-200 transition-colors">Tonight</Link>
          <Link href="/profile" className="hover:text-neutral-200 transition-colors">Profile</Link>
        </nav>
      </div>
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
