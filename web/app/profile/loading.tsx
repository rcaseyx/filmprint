export default function ProfileLoading() {
  return (
    <div className="py-12 space-y-10">
      <div className="max-w-2xl mx-auto px-6 space-y-8">
        {/* Title */}
        <div className="space-y-2">
          <div className="skeleton h-7 w-48 rounded-lg" />
          <div className="skeleton h-4 w-64 rounded" />
        </div>

        {/* ProfileStats skeleton */}
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-neutral-900 rounded-xl p-4 text-center border border-neutral-800 space-y-2">
              <div className="skeleton h-8 w-16 rounded mx-auto" />
              <div className="skeleton h-3 w-12 rounded mx-auto" />
            </div>
          ))}
        </div>
      </div>

      {/* Radar skeleton */}
      <div className="max-w-2xl mx-auto px-6 space-y-6">
        <div className="skeleton h-64 w-full rounded-xl" />

        {/* Genre bars skeleton */}
        <div className="space-y-3">
          <div className="skeleton h-3 w-28 rounded" />
          {[90, 75, 68, 55, 48, 40, 32, 25].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-3 w-24 rounded shrink-0" />
              <div className="flex-1 bg-neutral-800 rounded-full h-2">
                <div className="skeleton h-2 rounded-full" style={{ width: `${w}%` }} />
              </div>
              <div className="skeleton h-3 w-6 rounded" />
            </div>
          ))}
        </div>

        {/* Stat row skeleton */}
        <div className="skeleton h-[118px] w-full rounded-xl" />

        {/* Past picks scrollers skeleton */}
        <div className="space-y-2">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="flex gap-3 px-6 -mx-6 overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="shrink-0 w-[104px] space-y-1.5">
                <div className="skeleton w-[104px] h-[156px] rounded-lg" />
                <div className="skeleton h-2.5 w-16 rounded" />
                <div className="skeleton h-2.5 w-10 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
