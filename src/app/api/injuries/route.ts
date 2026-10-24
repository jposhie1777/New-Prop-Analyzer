import { runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlPlayerInjury } from "@/lib/bdl/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return runCachedRoute("injuries", "injuries", async () => {
    const injuries = await getServerBdlClient().getAllPages<BdlPlayerInjury>("/nba/v1/player_injuries", {});
    return { body: { data: injuries } };
  });
}
