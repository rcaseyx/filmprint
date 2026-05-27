import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"

const API = process.env.NEXT_PUBLIC_API_URL
const INTERNAL_SECRET = process.env.INTERNAL_SECRET

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        try {
          const res = await fetch(`${API}/api/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          })
          if (!res.ok) return null
          const user = await res.json()
          return {
            id: String(user.user_id),
            email: user.email,
            name: user.username || user.email,
            backendToken: user.token,
          }
        } catch {
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        if ((user as any).backendToken) {
          // Credentials login — token returned directly from /api/auth/verify
          token.backendToken = (user as any).backendToken
        } else if (account?.provider === "google" && token.email) {
          // Google OAuth — exchange verified email for a backend JWT server-to-server
          try {
            const res = await fetch(`${API}/api/auth/exchange`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": INTERNAL_SECRET || "",
              },
              body: JSON.stringify({ email: token.email }),
            })
            if (res.ok) {
              const data = await res.json()
              token.backendToken = data.token
            }
          } catch {}
        }
      }
      return token
    },
    async session({ session, token }) {
      session.backendToken = token.backendToken
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
}
