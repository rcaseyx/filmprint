import { ImportFlow } from "@/components/ImportFlow"

export default function OnboardingPage() {
  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to filmprint</h1>
        <p className="text-neutral-400 text-sm mt-3 leading-relaxed">
          filmprint builds a taste profile from your rated films and uses it to surface
          movies you&rsquo;ll actually want to watch. To do that, it needs your ratings data.
        </p>
        <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
          <p className="text-sm text-amber-300 font-medium">
            A full CSV export is required for personalized recommendations.
          </p>
          <p className="text-xs text-amber-400/70 mt-1">
            filmprint analyzes every rating you&rsquo;ve made — the more ratings, the better the
            recommendations. A partial import won&rsquo;t produce meaningful results.
          </p>
        </div>
      </div>

      <div className="mb-6 space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-neutral-500">How to export</h2>
        <ol className="space-y-2 text-sm text-neutral-300">
          <li className="flex gap-3">
            <span className="text-neutral-600 shrink-0">1.</span>
            <span>
              Go to{" "}
              <a
                href="https://letterboxd.com/settings/data"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-200 underline underline-offset-2 hover:text-white transition-colors"
              >
                letterboxd.com/settings/data
              </a>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-neutral-600 shrink-0">2.</span>
            <span>Click <span className="text-neutral-200">Export your data</span> — the zip downloads directly in your browser</span>
          </li>
          <li className="flex gap-3">
            <span className="text-neutral-600 shrink-0">3.</span>
            <span>Drop the zip below</span>
          </li>
        </ol>
      </div>

      <ImportFlow isOnboarding needsUsername />
    </div>
  )
}
