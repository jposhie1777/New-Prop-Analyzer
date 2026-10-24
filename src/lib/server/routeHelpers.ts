import { NextResponse } from "next/server";
import { buildCacheControlHeader, cachePolicies, type CachePolicy, type CachePolicyName } from "@/config/cacheTtls";
import { BdlRequestError } from "@/lib/bdl/bdlClient";
import { recordRouteInvocation } from "./usageCounters";

export interface RouteResult {
  body: unknown;
  policy?: CachePolicy;
  status?: number;
}

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function runCachedRoute(routeName: string, policyName: CachePolicyName, handler: () => Promise<RouteResult>): Promise<NextResponse> {
  const startedAt = performance.now();
  try {
    const result = await handler();
    const durationMs = Math.round(performance.now() - startedAt);
    recordRouteInvocation(routeName, durationMs);
    const policy = result.policy ?? cachePolicies[policyName];
    return NextResponse.json(result.body, {
      status: result.status ?? 200,
      headers: {
        "Cache-Control": buildCacheControlHeader(policy), // Vercel's CDN serves repeats without running the function
        "x-pulse-route": routeName,
        "x-pulse-duration-ms": String(durationMs),
        "x-pulse-generated-at": new Date().toISOString(),
      },
    });
  } catch (caughtError) {
    const durationMs = Math.round(performance.now() - startedAt);
    recordRouteInvocation(routeName, durationMs);
    if (caughtError instanceof BdlRequestError && (caughtError.status === 401 || caughtError.status === 403)) {
      return NextResponse.json(
        { data: [], unavailable: true, reason: "This endpoint needs a higher BALLDONTLIE tier (GOAT) or a valid key." },
        { status: 200, headers: { "Cache-Control": buildCacheControlHeader(cachePolicies.injuries), "x-pulse-route": routeName } }, // cache the refusal briefly to save calls
      );
    }
    const message = caughtError instanceof Error ? caughtError.message : "unknown error";
    console.error(`[${routeName}] ${message}`); // messages never contain the API key
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store", "x-pulse-route": routeName } });
  }
}

export function badRequest(message: string): NextResponse {
  return noStoreJson({ error: message }, 400);
}

export function parseIdList(rawValue: string | null, maxCount = 100): number[] {
  if (!rawValue) return [];
  return rawValue.split(",").map((part) => Number(part.trim())).filter((parsed) => Number.isInteger(parsed) && parsed > 0).slice(0, maxCount);
}
