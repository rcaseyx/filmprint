import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  const secureCookie =
    request.headers.get("x-forwarded-proto") === "https" ||
    process.env.NEXTAUTH_URL?.startsWith("https://") === true
  const token = await getToken({ req: request, secureCookie })

  if (!token) {
    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!login|signup|api/auth|_next/static|_next/image|favicon.ico)(?!.*\\..*).*)" ],
}
