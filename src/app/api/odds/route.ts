import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlBettingOdd } from "@/lib/bdl/types";
import { isIsoDate, todayEastern } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date") ?? todayEastern();
  if (!isIsoDate(requestedDate)) return badRequest("date must be YYYY-MM-DD");
  return runCachedRoute("odds-live", "liveOdds", async () => {
    const odds = await getServerBdlClient().getAllPages<BdlBettingOdd>("/nba/v2/odds", { "dates[]": [requestedDate] });
    return { body: { date: requestedDate, data: odds } };
  });
}
