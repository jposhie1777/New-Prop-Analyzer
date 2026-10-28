import { NextResponse, type NextRequest } from "next/server";
import { constantTimeEqual, safeNextPath, sessionCookieName, sessionMaxAgeSeconds, sessionToken } from "@/lib/auth/siteSession";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return NextResponse.json({ ok: true, next: "/" });
  let body: { password?: unknown; next?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const typed = typeof body.password === "string" ? body.password : "";
  if (!constantTimeEqual(await sessionToken(typed), await sessionToken(sitePassword))) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // slows down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.json({ ok: true, next: safeNextPath(typeof body.next === "string" ? body.next : "/") }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookieName, await sessionToken(sitePassword), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: sessionMaxAgeSeconds });
  return response;
}
