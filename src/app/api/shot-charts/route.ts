import type { NextRequest } from "next/server";
import { badRequest, parseIdList, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlShotChartRow } from "@/lib/bdl/types";
import { cachePolicies } from "@/config/cacheTtls";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gameIds = parseIdList(request.nextUrl.searchParams.get("game_ids"), 15).sort((first, second) => first - second);
  const teamId = Number(request.nextUrl.searchParams.get("team_id"));
  if (gameIds.length === 0 || !Number.isInteger(teamId) || teamId <= 0) return badRequest("game_ids and team_id are required");
  return runCachedRoute("shot-charts", "finishedDate", async () => {
    const shots = await getServerBdlClient().getAllPages<BdlShotChartRow>("/nba/v1/shot_charts", { "game_ids[]": gameIds, "team_ids[]": [teamId] }, 40); // finished games only, so the CDN keeps it for 30 days
    return { body: { team_id: teamId, game_ids: gameIds, data: shots }, policy: shots.length === 0 ? cachePolicies.unfinishedDate : undefined }; // an empty answer may just be late data, so don't pin it
  });
}
