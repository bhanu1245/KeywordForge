import { NextResponse, type NextRequest } from "next/server";
// Import from the constants-only module, never from session.ts — that would
// pull node:crypto and Prisma into the Edge runtime.
import { SESSION_COOKIE } from "@/lib/auth/cookie";

/**
 * Redirects signed-out visitors to /login before a page renders.
 *
 * SCOPE OF THIS CHECK — it is presence-only, deliberately. Middleware runs on
 * the edge runtime where Prisma is unavailable, so it cannot validate the
 * token. It is a UX guard, not the security boundary: a forged or expired
 * cookie sails through here and is then rejected by `resolveContext()`, which
 * does the authoritative database lookup. Never treat passing middleware as
 * being authenticated.
 *
 * API routes are excluded: an unauthenticated fetch should get a 401 JSON body
 * it can act on, not an HTML redirect that would parse as garbage.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  // The dev fast path bypasses login entirely, so the redirect must not fight
  // it. Mirrors the guard in resolveContext.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTO_LOGIN_EMAIL) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except: API routes (they return 401 JSON), the auth pages
   * themselves (redirecting those would loop — including the password-reset
   * pages, which by definition are reached while signed out), and Next's
   * static assets.
   */
  matcher: [
    "/((?!api|login|signup|forgot|reset|_next/static|_next/image|favicon.ico).*)",
  ],
};
