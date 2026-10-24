import type { BdlClient } from "@/lib/bdl/bdlClient";
import type { BdlAdvancedStatsV2, BdlGame, BdlLineup, BdlPlay, BdlStats } from "@/lib/bdl/types";
import { emptyFinalsTables, type DataRow, type FinalsPayload } from "@/lib/data/rowSchemas";
import { flattenAdvanced, flattenGame, flattenLineup, flattenPlayer, flattenStat, isGameFinal } from "@/lib/data/flatten";
import { buildTeamPeriodSummaries } from "@/lib/data/teamSummaries";
import { tierHasGoatEndpoints } from "@/config/tiers";

export async function mapWithConcurrency<InputType, OutputType>(items: InputType[], concurrencyLimit: number, worker: (item: InputType) => Promise<OutputType>): Promise<OutputType[]> {
  const results = new Array<OutputType>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrencyLimit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex++;
      results[itemIndex] = await worker(items[itemIndex]);
    }
  });
  await Promise.all(runners);
  return results;
}

function chunk<ItemType>(items: ItemType[], chunkSize: number): ItemType[][] {
  const chunks: ItemType[][] = [];
  for (let startIndex = 0; startIndex < items.length; startIndex += chunkSize) chunks.push(items.slice(startIndex, startIndex + chunkSize));
  return chunks;
}

const quarterPeriods = [1, 2, 3, 4]; // the stats period filter supports quarters 1-4 for completed games

export async function buildFinalsPayload(client: BdlClient, isoDate: string): Promise<FinalsPayload> {
  const callsBefore = client.callCount;
  const warnings: string[] = [];
  const tables = emptyFinalsTables();
  const games = await client.getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [isoDate] });
  const finalGames = games.filter(isGameFinal);
  const unresolvedGames = games.filter((game) => !isGameFinal(game) && !["postponed", "canceled", "abandoned"].includes(game.status_state ?? ""));
  const complete = unresolvedGames.length === 0;
  if (!complete) warnings.push(`${unresolvedGames.length} game(s) on ${isoDate} are not final yet`);
  tables.games = finalGames.map(flattenGame);
  if (finalGames.length === 0) return { date: isoDate, complete, generatedAt: new Date().toISOString(), bdlCalls: client.callCount - callsBefore, tables, warnings };

  const gameLookup = new Map(finalGames.map((game) => [game.id, game]));
  const finalGameIds = new Set(finalGames.map((game) => game.id));
  const goatEndpoints = tierHasGoatEndpoints(client.tier);

  const [fullGameStats, ...quarterStats] = await mapWithConcurrency([0, ...quarterPeriods], 5, (period) =>
    client.getAllPages<BdlStats>("/nba/v1/stats", { "dates[]": [isoDate], period: period === 0 ? undefined : period }),
  );
  tables.player_game_stats = fullGameStats.filter((statRow) => finalGameIds.has(statRow.game.id)).map((statRow) => flattenStat(statRow, gameLookup, null));
  tables.player_period_stats = quarterStats.flatMap((periodRows, periodIndex) =>
    periodRows.filter((statRow) => finalGameIds.has(statRow.game.id)).map((statRow) => flattenStat(statRow, gameLookup, quarterPeriods[periodIndex])),
  );

  const playersSeen = new Map<number, DataRow>();
  for (const statRow of fullGameStats) if (finalGameIds.has(statRow.game.id)) playersSeen.set(statRow.player.id, flattenPlayer(statRow.player, statRow.team.id, isoDate));
  tables.players = [...playersSeen.values()];

  if (goatEndpoints) {
    try {
      const advancedByPeriod = await mapWithConcurrency([0, ...quarterPeriods], 5, (period) =>
        client.getAllPages<BdlAdvancedStatsV2>("/nba/v2/stats/advanced", { "dates[]": [isoDate], period }),
      );
      tables.advanced_stats = advancedByPeriod.flatMap((periodRows, periodIndex) =>
        periodRows.filter((advancedRow) => finalGameIds.has(advancedRow.game.id)).map((advancedRow) => flattenAdvanced(advancedRow, gameLookup, periodIndex === 0 ? 0 : quarterPeriods[periodIndex - 1])),
      );
    } catch (caughtError) {
      warnings.push(`advanced stats unavailable: ${caughtError instanceof Error ? caughtError.message : "error"}`);
    }
    try {
      const lineupChunks = await mapWithConcurrency(chunk([...finalGameIds], 25), 3, (gameIdChunk) => client.getAllPages<BdlLineup>("/nba/v1/lineups", { game_ids: gameIdChunk }));
      tables.lineups = lineupChunks.flat().map((lineupRow) => flattenLineup(lineupRow, gameLookup));
    } catch (caughtError) {
      warnings.push(`lineups unavailable: ${caughtError instanceof Error ? caughtError.message : "error"}`);
    }
  }

  const periodRowsByGame = new Map<number, DataRow[]>();
  for (const periodRow of tables.player_period_stats) {
    const gameRows = periodRowsByGame.get(Number(periodRow.game_id)) ?? [];
    gameRows.push(periodRow);
    periodRowsByGame.set(Number(periodRow.game_id), gameRows);
  }
  const summariesByGame = await mapWithConcurrency(finalGames, 4, async (game) => {
    let plays: BdlPlay[] = [];
    if (goatEndpoints) {
      try {
        const playResponse = await client.get<{ data: BdlPlay[] }>("/nba/v1/plays", { game_id: game.id });
        plays = playResponse.data ?? []; // raw plays are summarized here and never stored
      } catch (caughtError) {
        warnings.push(`plays unavailable for game ${game.id}: ${caughtError instanceof Error ? caughtError.message : "error"}`);
      }
    }
    return buildTeamPeriodSummaries(game, plays, periodRowsByGame.get(game.id) ?? []);
  });
  tables.team_period_summaries = summariesByGame.flat();

  return { date: isoDate, complete, generatedAt: new Date().toISOString(), bdlCalls: client.callCount - callsBefore, tables, warnings };
}
