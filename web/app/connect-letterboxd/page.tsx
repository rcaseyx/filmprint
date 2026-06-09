import Link from "next/link"
import { ConnectLetterboxdFlow } from "@/components/ConnectLetterboxdFlow"

export default function ConnectLetterboxdPage() {
  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <Link href="/profile" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors mb-8">
        ← Back to profile
      </Link>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connect your Letterboxd account</h1>
        <p className="text-neutral-400 text-sm mt-3 leading-relaxed">
          Enter your Letterboxd username to sync your ratings and watchlist.
          Optionally upload a data export to pull in your full history right away.
        </p>
      </div>
      <ConnectLetterboxdFlow />
    </div>
  )
}
