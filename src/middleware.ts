import { NextResponse, type NextRequest } from "next/server";
import { constantTimeEqual, sessionCookieName, sessionToken } from "@/lib/auth/siteSession";

export async function middleware(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return NextResponse.next(); // no password set: the site is open, as in local development
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const cookieValue = request.cookies.get(sessionCookieName)?.value ?? "";
  if (cookieValue && constantTimeEqual(cookieValue, await sessionToken(sitePassword))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|duckdb/|data/).*)"], // static files and the public stats data skip the check
};
