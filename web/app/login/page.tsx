"use client"

import { signIn } from "next-auth/react"

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">filmprint</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            Personalized picks from your Letterboxd taste
          </p>
        </div>
        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          className="flex items-center gap-2 px-5 py-2.5 bg-neutral-100 text-neutral-900 rounded-lg font-medium text-sm hover:bg-white transition-colors mx-auto"
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  )
}
