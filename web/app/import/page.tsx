import Link from "next/link"
import { ImportFlow } from "@/components/ImportFlow"

export default function ImportPage() {
  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <div className="mb-8">
        <Link href="/profile" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors uppercase tracking-wider">
          ← Profile
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-4">Import Letterboxd data</h1>
        <p className="text-neutral-400 text-sm mt-2">
          Go to{" "}
          <a
            href="https://letterboxd.com/settings/data"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-300 underline underline-offset-2 hover:text-white transition-colors"
          >
            letterboxd.com/settings/data
          </a>
          , click <span className="text-neutral-300">Export your data</span>, then drop the zip below.
        </p>
      </div>
      <ImportFlow />
    </div>
  )
}
