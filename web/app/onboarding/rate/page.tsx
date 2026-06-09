import { InAppRatingFlow } from "@/components/InAppRatingFlow"

export default function RateFilmsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Rate some films</h1>
        <p className="text-neutral-400 text-sm mt-2 leading-relaxed">
          Rate at least 8 films you&rsquo;ve seen. Skip anything you haven&rsquo;t watched.
        </p>
      </div>
      <InAppRatingFlow />
    </div>
  )
}
