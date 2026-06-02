"use client"

import { useState } from "react"
import { GenreRadar } from "@/components/GenreRadar"

interface DataPoint {
  name: string
  weight: number
  count?: number
}

type RadarExamples = Record<string, { id: number; title: string; year: number | null; rating: number; poster_path: string | null }[]>

type Tab = "Genre" | "Themes" | "Era" | "Tone"

const TABS: Tab[] = ["Genre", "Themes", "Era", "Tone"]

interface Props {
  genres: DataPoint[]
  subgenres: DataPoint[]
  decades: DataPoint[]
  tone: DataPoint[]
  examples: { genre: RadarExamples; subgenre: RadarExamples; era: RadarExamples; tone: RadarExamples }
}

export function RadarSection({ genres, subgenres, decades, tone, examples }: Props) {
  const [active, setActive] = useState<Tab>("Genre")

  const datasets: Record<Tab, DataPoint[]> = {
    "Genre": genres.slice(0, 8),
    "Themes": subgenres,
    "Era": decades,
    "Tone": tone,
  }

  const examplesMap: Record<Tab, RadarExamples> = {
    "Genre": examples.genre,
    "Themes": examples.subgenre,
    "Era": examples.era,
    "Tone": examples.tone,
  }

  return (
    <div className="flex flex-col items-center gap-0">
      <div className="flex gap-6 border-b border-neutral-800 w-full justify-center mb-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`text-sm pb-2.5 transition-colors ${
              active === tab
                ? "text-neutral-100 border-b border-brand -mb-px"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="w-full max-w-md mx-auto">
        <GenreRadar
          key={active}
          data={datasets[active]}
          initialExamples={examplesMap[active]}
        />
      </div>
    </div>
  )
}
