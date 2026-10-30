import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { cachePolicies } from "@/config/cacheTtls";
import { isIsoDate, todayEastern } from "@/lib/dates";
import { getServerNcaabClient } from "@/lib/ncaab/serverClient";
import { isNcaabLive, type NcaabGame } from "@/lib/ncaab/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date") ?? todayEastern();
  if (!isIsoDate(requestedDate)) return badRequest("date must be YYYY-MM-DD");
  return runCachedRoute("ncaabGames", "schedule", async () => {
    const games = await getServerNcaabClient().getAllPages<NcaabGame>("/ncaab/v1/games", { "dates[]": [requestedDate] });
    return { body: { date: requestedDate, games }, policy: games.some(isNcaabLive) ? cachePolicies.liveBoxScores : undefined }; // live scores refresh every 30 s, otherwise every 5 min
  });
}
