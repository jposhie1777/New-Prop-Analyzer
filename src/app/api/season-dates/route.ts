import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import type { BdlGame } from "@/lib/bdl/types";
import { todayEastern } from "@/lib/dates";
import { isGameFinal } from "@/lib/data/flatten";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const season = Number(request.nextUrl.searchParams.get("season"));
  if (!Number.isInteger(season) || season < 1946 || season > 2100) return badRequest("season must be a start year like 2026");
  const startDate = request.nextUrl.searchParams.get("start_date") ?? undefined;
  return runCachedRoute("season-dates", "seasonDates", async () => {
    const today = todayEastern();
    const games = await getServerBdlClient().getAllPages<BdlGame>("/nba/v1/games", { "seasons[]": [season], start_date: startDate, end_date: today });
    const dateSummary = new Map<string, { games: number; final: number }>();
    for (const game of games) {
      const entry = dateSummary.get(game.date) ?? { games: 0, final: 0 };
      entry.games += 1;
      if (isGameFinal(game)) entry.final += 1;
      dateSummary.set(game.date, entry);
    }
    const dates = [...dateSummary.entries()].sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate)).map(([gameDate, counts]) => ({ date: gameDate, ...counts }));
    return { body: { season, today, dates } };
  });
}
