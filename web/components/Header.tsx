"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"

export function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()

  if (!session) return null

  const navLink = (href: string, label: string) => {
    const active = pathname === href
    return (
      <Link
        href={href}
        className={`text-sm transition-colors ${
          active
            ? "text-neutral-100 font-medium"
            : "text-neutral-500 hover:text-neutral-300"
        }`}
      >
        {label}
        {active && <span className="block h-px bg-amber-400 mt-px rounded-full" />}
      </Link>
    )
  }

  return (
    <header className="border-b border-neutral-800/60 px-6 py-5 flex items-center justify-between">
      <div className="flex items-center gap-7">
        <Link href="/" className="text-amber-400 font-semibold text-lg tracking-tight hover:text-amber-300 transition-colors">
          filmprint
        </Link>
        <nav className="flex items-center gap-5">
          {navLink("/", "Tonight")}
          {navLink("/profile", "Profile")}
        </nav>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-neutral-500">{session.user?.name}</span>
        <button
          onClick={() => signOut()}
          className="text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
