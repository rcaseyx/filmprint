const COLORS = [
  "#d97706", "#059669", "#2563eb", "#7c3aed",
  "#db2777", "#dc2626", "#0891b2", "#65a30d",
]

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

interface Props {
  name: string
  size?: number
}

export function Avatar({ name, size = 36 }: Props) {
  const initials = name.slice(0, 2).toUpperCase()
  const bg = hashColor(name)
  return (
    <div
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
      className="rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none"
    >
      {initials}
    </div>
  )
}
