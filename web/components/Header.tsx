"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { PrintLogo } from "./PrintLogo"

export function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  if (!session) {
    return (
      <header className="border-b border-neutral-800/60 px-4 sm:px-6 h-14 sm:h-16 flex items-center gap-4">
        <Link href="/">
          <PrintLogo className="h-8 sm:h-10 w-auto" />
        </Link>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">
          Home
        </Link>
      </header>
    )
  }

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
          <PrintLogo className="h-8 sm:h-10 w-auto" />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          {navLink("/picks", "Picks")}
          {navLink("/profile", "Profile")}
          {navLink("/search", "People")}
          {navLink("/games", "Games")}
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
        {/* Hamburger menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex flex-col justify-center items-center w-8 h-8 gap-1.5"
            aria-label="Menu"
          >
            <span className={`block w-5 h-px bg-neutral-400 transition-transform duration-200 ${menuOpen ? "rotate-45 translate-y-[7px]" : ""}`} />
            <span className={`block w-5 h-px bg-neutral-400 transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-5 h-px bg-neutral-400 transition-transform duration-200 ${menuOpen ? "-rotate-45 -translate-y-[7px]" : ""}`} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-40 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden z-50">
              <Link
                href="/support"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-3 text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
              >
                Support
              </Link>
              <button
                onClick={() => { setMenuOpen(false); signOut() }}
                className="w-full text-left px-4 py-3 text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
