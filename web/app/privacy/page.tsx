export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-lg font-medium text-neutral-100 mb-1">Privacy Policy</h1>
      <p className="text-sm text-neutral-500 mb-10">Last updated: June 16, 2026</p>

      <div className="flex flex-col gap-8 text-sm text-neutral-300 leading-relaxed">
        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">What we collect</h2>
          <ul className="flex flex-col gap-1.5 text-neutral-400">
            <li><span className="text-neutral-300">Email address</span> — provided when you create an account or sign in</li>
            <li><span className="text-neutral-300">Film ratings and watchlist</span> — entered manually or imported from Letterboxd</li>
            <li><span className="text-neutral-300">Letterboxd username</span> — if you choose to connect your Letterboxd account</li>
            <li><span className="text-neutral-300">Usage data</span> — which recommendations you receive and whether you mark them as watched</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">How we use it</h2>
          <p className="text-neutral-400">
            All data is used solely to generate and improve your film recommendations.
            We do not sell your data, use it for advertising, or share it with third
            parties except as described below.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">Third-party services</h2>
          <ul className="flex flex-col gap-1.5 text-neutral-400">
            <li><span className="text-neutral-300">Google OAuth</span> — optional sign-in method; subject to Google&apos;s Privacy Policy</li>
            <li><span className="text-neutral-300">The Movie Database (TMDB)</span> — provides film metadata; we send film titles and IDs to their API</li>
            <li><span className="text-neutral-300">Anthropic</span> — powers certain recommendation features; prompts may include your taste profile data but not your name or email</li>
            <li><span className="text-neutral-300">Letterboxd</span> — if connected, we fetch your public ratings via their website</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">Data retention</h2>
          <p className="text-neutral-400">
            Your account and all associated data are retained until you delete your account.
            To request deletion, contact us at the address below.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">Your rights</h2>
          <p className="text-neutral-400">
            You may request access to, correction of, or deletion of your personal data
            at any time by contacting us.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-neutral-100 font-medium">Contact</h2>
          <p className="text-neutral-400">
            <a href="mailto:rcaseyx@gmail.com" className="text-neutral-300 hover:text-white transition-colors">
              rcaseyx@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
