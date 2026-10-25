import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlPlay } from "@/lib/bdl/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gameId = Number(request.nextUrl.searchParams.get("game_id"));
  if (!Number.isInteger(gameId) || gameId <= 0) return badRequest("game_id is required");
  return runCachedRoute("plays-live", "livePlays", async () => {
    const response = await getServerBdlClient().get<{ data: BdlPlay[] }>("/nba/v1/plays", { game_id: gameId }); // the whole game in one response
    return { body: { game_id: gameId, data: response.data ?? [] } };
  });
}
