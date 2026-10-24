import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlGame } from "@/lib/bdl/types";
import { isIsoDate, todayEastern } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date") ?? todayEastern();
  if (!isIsoDate(requestedDate)) return badRequest("date must be YYYY-MM-DD");
  return runCachedRoute("schedule", "schedule", async () => {
    const games = await getServerBdlClient().getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [requestedDate] });
    return { body: { date: requestedDate, games } };
  });
}
