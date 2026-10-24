import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlNumberList, sqlString } from "@/lib/analytics/engine";
import type { ScopeName } from "@/lib/analytics/views";
import { readWindowSummary, windowNames, windowedAggregateColumns, type MetricSummary, type WindowName } from "./windows";
import { daysBetween } from "@/lib/dates";

export const teamMetricColumns = ["points", "opp_points", "pace_value", "off_rating", "def_rating", "possessions"] as const;
export type TeamMetric = (typeof teamMetricColumns)[number];

export type TeamWindowTable = Record<number, Partial<Record<ScopeName, Record<WindowName, Record<TeamMetric, MetricSummary>>>>>;

export const teamLinesCte = `team_lines AS (
    SELECT *, (possessions + opp_possessions) / 2 * 48 / NULLIF(minutes, 0) AS pace_value,
      100 * points / NULLIF(possessions, 0) AS off_rating, 100 * opp_points / NULLIF(opp_possessions, 0) AS def_rating
    FROM team_scope_lines
  )`; // pace = possessions per 48, ratings per 100 possessions

export async function teamWindowAggregates(engine: AnalyticsEngine, season: number, teamIds: number[] | null = null): Promise<TeamWindowTable> {
  const teamFilter = teamIds && teamIds.length > 0 ? `AND team_id IN (${sqlNumberList(teamIds)})` : "";
  const aggregateRows = await engine.query<Record<string, unknown>>(`
    WITH ${teamLinesCte},
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY team_id, scope ORDER BY game_date DESC, game_id DESC) AS recency
      FROM team_lines WHERE season = ${sqlNumber(season)} ${teamFilter}
    )
    SELECT team_id, scope, ${windowedAggregateColumns(teamMetricColumns).join(", ")} FROM ranked GROUP BY team_id, scope`);
  const table: TeamWindowTable = {};
  for (const aggregateRow of aggregateRows) {
    const teamId = Number(aggregateRow.team_id);
    table[teamId] ??= {};
    const windowsForScope = {} as Record<WindowName, Record<TeamMetric, MetricSummary>>;
    for (const windowName of windowNames) {
      windowsForScope[windowName] = {} as Record<TeamMetric, MetricSummary>;
      for (const metricName of teamMetricColumns) windowsForScope[windowName][metricName] = readWindowSummary(aggregateRow, metricName, windowName);
    }
    table[teamId][aggregateRow.scope as ScopeName] = windowsForScope;
  }
  return table;
}

export interface RestInfo {
  teamId: number;
  previousGameDate: string | null;
  restDays: number | null;
  backToBack: boolean;
}

export function restFromPreviousGame(teamId: number, previousGameDate: string | null, gameDate: string): RestInfo {
  if (!previousGameDate) return { teamId, previousGameDate: null, restDays: null, backToBack: false };
  const restDays = Math.max(0, daysBetween(previousGameDate, gameDate) - 1); // days off between games
  return { teamId, previousGameDate, restDays, backToBack: restDays === 0 };
}

export async function teamRest(engine: AnalyticsEngine, teamIds: number[], gameDate: string): Promise<Map<number, RestInfo>> {
  if (teamIds.length === 0) return new Map();
  const previousRows = await engine.query<{ team_id: number; previous_date: string | null }>(`
    WITH appearances AS (
      SELECT home_team_id AS team_id, game_date FROM games UNION ALL SELECT visitor_team_id AS team_id, game_date FROM games
    )
    SELECT team_id, MAX(game_date) AS previous_date FROM appearances
    WHERE team_id IN (${sqlNumberList(teamIds)}) AND game_date < ${sqlString(gameDate)} GROUP BY team_id`);
  const restByTeam = new Map<number, RestInfo>();
  for (const teamId of teamIds) {
    const previousRow = previousRows.find((candidate) => Number(candidate.team_id) === teamId);
    restByTeam.set(teamId, restFromPreviousGame(teamId, previousRow?.previous_date ?? null, gameDate));
  }
  return restByTeam;
}
