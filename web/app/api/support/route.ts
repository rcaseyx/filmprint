import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { title, description } = await req.json()
  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Title and description are required" }, { status: 400 })
  }

  const token = process.env.GITHUB_SUPPORT_TOKEN
  if (!token) return NextResponse.json({ error: "Support unavailable" }, { status: 503 })

  const body = `**Reported by:** ${session.user?.name ?? session.user?.email}\n\n${description.trim()}`

  const res = await fetch("https://api.github.com/repos/rcaseyx/filmprint/issues", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: title.trim(),
      body,
      labels: ["bug", "beta-feedback"],
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to file issue" }, { status: 502 })
  }

  const issue = await res.json()
  return NextResponse.json({ number: issue.number })
}
