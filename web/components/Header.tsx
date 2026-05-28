"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { PrintLogo } from "./PrintLogo"

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
        {active && <span className="block h-px bg-brand mt-px rounded-full" />}
      </Link>
    )
  }

  return (
    <header className="border-b border-neutral-800/60 px-6 h-20 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link href="/">
          <PrintLogo className="h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-5">
          {navLink("/", "Picks")}
          {navLink("/profile", "Profile")}
          {navLink("/search", "People")}
        </nav>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-neutral-500">{session.user?.name}</span>
        <Link
          href="/support"
          className="text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          Support
        </Link>
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
