import { runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlListResponse } from "@/lib/bdl/types";
import { normalizeBoxScores } from "@/lib/bdl/normalize";

export const dynamic = "force-dynamic";

export async function GET() {
  return runCachedRoute("live-box-scores", "liveBoxScores", async () => {
    const response = await getServerBdlClient().get<BdlListResponse<unknown>>("/nba/v1/box_scores/live", {}); // cumulative live box scores
    return { body: { fetchedAt: new Date().toISOString(), data: normalizeBoxScores(response.data) } };
  });
}
