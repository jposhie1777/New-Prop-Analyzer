import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlNumberList } from "@/lib/analytics/engine";

export const usageMetrics = ["minutes", "pts", "reb", "ast", "fg3m", "fga", "pra", "usage_percentage"] as const;
export type UsageMetric = (typeof usageMetrics)[number];

export interface UsageSplit {
  games: number;
  averages: Record<UsageMetric, number | null>;
}

export interface UsageShiftResult {
  teammateId: number;
  withTeammate: UsageSplit;
  withoutTeammate: UsageSplit;
  deltas: Record<UsageMetric, number | null>;
}

export async function usageShift(engine: AnalyticsEngine, playerId: number, teammateIds: number[], seasons: number[]): Promise<UsageShiftResult[]> {
  if (teammateIds.length === 0) return [];
  const averageColumns = usageMetrics.map((metricName) => `AVG("${metricName}") AS "${metricName}"`).join(", ");
  const splitRows = await engine.query<Record<string, unknown>>(`
    WITH player_games AS (
      SELECT stat_line.season, stat_line.game_id, stat_line.team_id, stat_line.minutes, stat_line.pts, stat_line.reb, stat_line.ast, stat_line.fg3m, stat_line.fga,
        stat_line.pts + stat_line.reb + stat_line.ast AS pra, advanced_row.usage_percentage
      FROM player_game_stats AS stat_line
      LEFT JOIN advanced_stats AS advanced_row ON advanced_row.game_id = stat_line.game_id AND advanced_row.player_id = stat_line.player_id AND advanced_row.period = 0
      WHERE stat_line.player_id = ${sqlNumber(playerId)} AND stat_line.minutes > 0 AND stat_line.season IN (${sqlNumberList(seasons)})
    ),
    teammate_teams AS (
      SELECT DISTINCT player_id AS teammate_id, season, team_id FROM player_game_stats
      WHERE player_id IN (${sqlNumberList(teammateIds)}) AND season IN (${sqlNumberList(seasons)})
    ),
    paired AS (
      SELECT teammate_teams.teammate_id, player_games.*,
        EXISTS (SELECT 1 FROM player_game_stats AS mate_line WHERE mate_line.player_id = teammate_teams.teammate_id AND mate_line.game_id = player_games.game_id AND mate_line.minutes > 0) AS teammate_played
      FROM player_games JOIN teammate_teams ON teammate_teams.season = player_games.season AND teammate_teams.team_id = player_games.team_id
    )
    SELECT teammate_id, teammate_played, COUNT(*) AS games, ${averageColumns} FROM paired GROUP BY teammate_id, teammate_played`); // only games where both were on the same team that season
  return teammateIds.map((teammateId) => {
    const splitFor = (played: boolean): UsageSplit => {
      const splitRow = splitRows.find((candidate) => Number(candidate.teammate_id) === teammateId && Boolean(candidate.teammate_played) === played);
      const averages = {} as Record<UsageMetric, number | null>;
      for (const metricName of usageMetrics) {
        const rawValue = splitRow?.[metricName];
        averages[metricName] = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
      }
      return { games: Number(splitRow?.games ?? 0), averages };
    };
    const withTeammate = splitFor(true);
    const withoutTeammate = splitFor(false);
    const deltas = {} as Record<UsageMetric, number | null>;
    for (const metricName of usageMetrics) {
      const withValue = withTeammate.averages[metricName];
      const withoutValue = withoutTeammate.averages[metricName];
      deltas[metricName] = withValue !== null && withoutValue !== null ? withoutValue - withValue : null;
    }
    return { teammateId, withTeammate, withoutTeammate, deltas };
  });
}
