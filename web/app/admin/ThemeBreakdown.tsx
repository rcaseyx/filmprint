"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

interface Theme {
  name: string
  count: number
  keywords: string[]
  sources: Record<string, number>
}

const PREVIEW_KW = 8

export function ThemeBreakdown() {
  const { data: session } = useSession()
  const [themes, setThemes] = useState<Theme[] | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "multi" | "singleton">("multi")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/themes/breakdown`, { headers: authHeader(session) })
      .then((r) => r.json())
      .then((d) => setThemes(d.themes))
      .catch(() => setThemes([]))
  }, [session])

  if (themes === null) {
    return <p className="text-xs text-neutral-600 animate-pulse">Loading themes…</p>
  }

  const q = search.trim().toLowerCase()
  const visible = themes.filter((t) => {
    if (filter === "multi" && t.count < 2) return false
    if (filter === "singleton" && t.count > 1) return false
    if (q) return t.name.toLowerCase().includes(q) || t.keywords.some((k) => k.toLowerCase().includes(q))
    return true
  })

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search themes or keywords…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-xs bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
        />
        <div className="flex text-xs rounded-lg border border-neutral-700 overflow-hidden">
          {(["all", "multi", "singleton"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 transition-colors ${filter === f ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              {f === "all" ? "All" : f === "multi" ? "Multi-kw" : "Singleton"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-600">{visible.length.toLocaleString()} themes</p>

      {/* Theme list */}
      <div className="rounded-xl border border-neutral-800 overflow-hidden divide-y divide-neutral-800/60 max-h-[32rem] overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-4 py-6 text-xs text-neutral-600 text-center">No matching themes</p>
        )}
        {visible.map((t) => {
          const isExpanded = expanded.has(t.name)
          const shownKws = isExpanded ? t.keywords : t.keywords.slice(0, PREVIEW_KW)
          const hiddenCount = t.keywords.length - PREVIEW_KW

          return (
            <div key={t.name} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-neutral-200">{t.name}</span>
                <span className="text-xs text-neutral-600 tabular-nums">{t.count}</span>
                {t.sources.seed && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-500 border border-amber-900/60">seed</span>
                )}
                {t.sources.claude && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-900/60">claude</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {shownKws.map((kw) => (
                  <span key={kw} className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">{kw}</span>
                ))}
                {!isExpanded && hiddenCount > 0 && (
                  <button
                    onClick={() => toggleExpand(t.name)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800/60 text-neutral-600 hover:text-neutral-400 transition-colors"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {isExpanded && (
                  <button
                    onClick={() => toggleExpand(t.name)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800/60 text-neutral-600 hover:text-neutral-400 transition-colors"
                  >
                    show less
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
