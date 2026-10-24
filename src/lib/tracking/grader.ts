import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumberList } from "@/lib/analytics/engine";
import { gradePick, type TrackedPick } from "./tracker";

export async function gradePendingPicks(engine: AnalyticsEngine, picks: TrackedPick[], today: string): Promise<TrackedPick[]> {
  const pending = picks.filter((pick) => !pick.result && pick.gameDate < today); // today's games are never final yet
  if (pending.length === 0) return [];
  const gameIds = [...new Set(pending.map((pick) => pick.gameId))];
  const games = await engine.query<{ game_id: number; home_team_id: number; home_score: number; visitor_score: number }>(
    `SELECT game_id, home_team_id, home_score, visitor_score FROM games WHERE game_id IN (${sqlNumberList(gameIds)})`,
  );
  const gameById = new Map(games.map((gameRow) => [Number(gameRow.game_id), gameRow]));
  const propPicks = pending.filter((pick) => pick.kind === "prop" && pick.playerId !== null && pick.metric && pick.scope);
  const statLines = propPicks.length > 0
    ? await engine.query<Record<string, unknown>>(`SELECT * FROM player_scope_lines WHERE game_id IN (${sqlNumberList([...new Set(propPicks.map((pick) => pick.gameId))])}) AND player_id IN (${sqlNumberList([...new Set(propPicks.map((pick) => pick.playerId!))])})`)
    : [];
  const teamPicks = pending.filter((pick) => pick.kind === "team_three_quarters" && pick.teamId !== null);
  const teamLines = teamPicks.length > 0
    ? await engine.query<{ game_id: number; team_id: number; points: number }>(`SELECT game_id, team_id, points FROM team_scope_lines WHERE scope = 'T3' AND game_id IN (${sqlNumberList([...new Set(teamPicks.map((pick) => pick.gameId))])})`)
    : [];
  const gradedAt = new Date().toISOString();
  const graded: TrackedPick[] = [];
  for (const pick of pending) {
    const gameRow = gameById.get(pick.gameId);
    if (!gameRow) continue; // the final hasn't synced into DuckDB yet, try again later
    let actual: number | null = null;
    if (pick.kind === "prop") {
      const statLine = statLines.find((candidate) => Number(candidate.game_id) === pick.gameId && Number(candidate.player_id) === pick.playerId && candidate.scope === pick.scope);
      const fullGame = statLines.find((candidate) => Number(candidate.game_id) === pick.gameId && Number(candidate.player_id) === pick.playerId && candidate.scope === "FG");
      actual = statLine && Number(fullGame?.minutes ?? 0) > 0 ? Number(statLine[pick.metric!] ?? 0) : null; // a DNP voids the prop
    } else if (pick.kind === "team_three_quarters") {
      const teamLine = teamLines.find((candidate) => Number(candidate.game_id) === pick.gameId && Number(candidate.team_id) === pick.teamId);
      actual = teamLine ? Number(teamLine.points) : null;
    } else if (pick.kind === "total") {
      actual = Number(gameRow.home_score) + Number(gameRow.visitor_score);
    } else {
      actual = Number(gameRow.home_score) - Number(gameRow.visitor_score); // home margin for spreads and moneylines
    }
    graded.push({ ...pick, result: { status: gradePick(pick, { actual }), actual, gradedAt } });
  }
  return graded;
}
