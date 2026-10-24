import type { NextRequest } from "next/server";
import { badRequest, parseIdList, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlListResponse, BdlPlayer } from "@/lib/bdl/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchText = (request.nextUrl.searchParams.get("search") ?? "").trim();
  const playerIds = parseIdList(request.nextUrl.searchParams.get("ids"));
  if (!searchText && playerIds.length === 0) return badRequest("pass search or ids");
  if (searchText && searchText.length < 2) return badRequest("search needs at least 2 characters");
  return runCachedRoute("players", "players", async () => {
    const response = await getServerBdlClient().get<BdlListResponse<BdlPlayer>>("/nba/v1/players/active", {
      search: searchText || undefined,
      "player_ids[]": playerIds.length > 0 ? playerIds : undefined,
      per_page: 50,
    });
    return { body: { data: response.data ?? [] } };
  });
}
