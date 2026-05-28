"use client"

import Image from "next/image"
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
    <header className="border-b border-neutral-800/60 px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
      <div className="flex items-center gap-3 sm:gap-4">
        <Link href="/">
          <PrintLogo className="h-10 sm:h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          {navLink("/", "Picks")}
          {navLink("/profile", "Profile")}
          {navLink("/search", "People")}
        </nav>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 text-sm">
        <Link href="/profile" className="shrink-0">
          {session.user?.image ? (
            <Image
              src={session.user.image}
              alt="Profile"
              width={36}
              height={36}
              className="rounded-full"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 flex items-center justify-center text-xs font-medium select-none">
              {(session.user?.name || session.user?.email || "?")[0].toUpperCase()}
            </div>
          )}
        </Link>
        <Link
          href="/support"
          className="hidden sm:inline text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          Support
        </Link>
        <button
          onClick={() => signOut()}
          className="hidden sm:inline text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
