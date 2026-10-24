import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlListResponse, BdlPlayerProp } from "@/lib/bdl/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gameId = Number(request.nextUrl.searchParams.get("game_id"));
  if (!Number.isInteger(gameId) || gameId <= 0) return badRequest("game_id is required");
  return runCachedRoute("props-opening", "openingProps", async () => {
    const response = await getServerBdlClient().get<BdlListResponse<BdlPlayerProp>>("/nba/v2/odds/player_props/opening", { game_id: gameId });
    return { body: { game_id: gameId, data: response.data ?? [] } };
  });
}
