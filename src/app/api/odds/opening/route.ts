import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { BdlRequestError, getServerBdlClient, type QueryParams } from "@/lib/bdl/bdlClient";
import type { BdlBettingOdd, BdlGame } from "@/lib/bdl/types";
import { isIsoDate, todayEastern } from "@/lib/dates";
import { cachePolicies } from "@/config/cacheTtls";

export const dynamic = "force-dynamic";

const workingParamStyle = new Map<string, number>(); // remembers which param style BDL accepted, per instance

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date") ?? todayEastern();
  if (!isIsoDate(requestedDate)) return badRequest("date must be YYYY-MM-DD");
  return runCachedRoute("odds-opening", "openingOdds", async () => {
    const client = getServerBdlClient();
    const gameIdsFor = async () => (await client.getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [requestedDate] })).map((game) => game.id);
    const attempts: Array<() => Promise<QueryParams>> = [
      async () => ({ "dates[]": [requestedDate] }),
      async () => ({ dates: [requestedDate] }), // the spec's spelling
      async () => ({ "game_ids[]": await gameIdsFor() }),
      async () => ({ game_ids: await gameIdsFor() }),
    ];
    const startIndex = workingParamStyle.get("opening") ?? 0;
    let lastError: unknown;
    for (let attemptIndex = startIndex; attemptIndex < attempts.length; attemptIndex++) {
      try {
        const params = await attempts[attemptIndex]();
        const odds = await client.getAllPages<BdlBettingOdd>("/nba/v2/odds/opening", params);
        workingParamStyle.set("opening", attemptIndex);
        return { body: { date: requestedDate, data: odds }, policy: requestedDate < todayEastern() && odds.length > 0 ? cachePolicies.finishedDate : undefined }; // a past day's opening lines never change
      } catch (caughtError) {
        lastError = caughtError;
        if (!(caughtError instanceof BdlRequestError) || caughtError.status !== 400) throw caughtError; // only a 400 means "try another param style"
      }
    }
    throw lastError;
  });
}
