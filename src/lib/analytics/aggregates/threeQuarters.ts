import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumberList } from "@/lib/analytics/engine";
import { readWindowSummary, windowFilter, windowNames, windowedAggregateColumns, type MetricSummary, type WindowName } from "./windows";
import { probabilityAtLeast } from "@/lib/math/probability";
import { appSettings } from "@/config/appSettings";

export interface ThreeQuarterSeasonProfile {
  teamId: number;
  season: number;
  scored: Record<WindowName, MetricSummary>;
  allowed: Record<WindowName, MetricSummary>;
  pace: Record<WindowName, MetricSummary>;
  scoredHundred: Record<WindowName, number>;
  allowedHundred: Record<WindowName, number>;
  threeQuarterPoints: number;
  fullGamePoints: number;
}

export async function threeQuarterProfiles(engine: AnalyticsEngine, teamIds: number[], seasons: number[]): Promise<ThreeQuarterSeasonProfile[]> {
  if (teamIds.length === 0) return [];
  const target = appSettings.hundredThroughThreeTarget;
  const hundredColumns = windowNames.flatMap((windowName) => [
    `COUNT(*) FILTER (WHERE ${windowFilter(windowName)} AND points >= ${target}) AS "scored_hundred__${windowName}"`,
    `COUNT(*) FILTER (WHERE ${windowFilter(windowName)} AND opp_points >= ${target}) AS "allowed_hundred__${windowName}"`,
  ]);
  const profileRows = await engine.query<Record<string, unknown>>(`
    WITH three_quarters AS (
      SELECT season, game_date, game_id, team_id, points, opp_points FROM team_scope_lines
      WHERE scope = 'T3' AND team_id IN (${sqlNumberList(teamIds)}) AND season IN (${sqlNumberList(seasons)})
    ),
    full_games AS (
      SELECT game_id, team_id, points AS full_points, (possessions + opp_possessions) / 2 * 48 / NULLIF(minutes, 0) AS pace_value FROM team_scope_lines WHERE scope = 'FG'
    ),
    joined AS (
      SELECT three_quarters.*, full_games.full_points, full_games.pace_value,
        ROW_NUMBER() OVER (PARTITION BY three_quarters.team_id, three_quarters.season ORDER BY three_quarters.game_date DESC, three_quarters.game_id DESC) AS recency
      FROM three_quarters JOIN full_games ON full_games.game_id = three_quarters.game_id AND full_games.team_id = three_quarters.team_id
    )
    SELECT team_id, season, SUM(points) AS three_quarter_points, SUM(full_points) AS full_game_points,
      ${windowedAggregateColumns(["points", "opp_points", "pace_value"]).join(", ")}, ${hundredColumns.join(", ")}
    FROM joined GROUP BY team_id, season`);
  return profileRows.map((profileRow) => {
    const byWindow = <ValueType,>(reader: (windowName: WindowName) => ValueType) => Object.fromEntries(windowNames.map((windowName) => [windowName, reader(windowName)])) as Record<WindowName, ValueType>;
    return {
      teamId: Number(profileRow.team_id),
      season: Number(profileRow.season),
      scored: byWindow((windowName) => readWindowSummary(profileRow, "points", windowName)),
      allowed: byWindow((windowName) => readWindowSummary(profileRow, "opp_points", windowName)),
      pace: byWindow((windowName) => readWindowSummary(profileRow, "pace_value", windowName)),
      scoredHundred: byWindow((windowName) => Number(profileRow[`scored_hundred__${windowName}`] ?? 0)),
      allowedHundred: byWindow((windowName) => Number(profileRow[`allowed_hundred__${windowName}`] ?? 0)),
      threeQuarterPoints: Number(profileRow.three_quarter_points ?? 0),
      fullGamePoints: Number(profileRow.full_game_points ?? 0),
    };
  });
}

export interface ShareEstimate {
  share: number | null;
  source: "current season" | "current + last season" | "last season" | "none";
  games: number;
}

export function estimateThreeQuarterShare(current: ThreeQuarterSeasonProfile | undefined, previous: ThreeQuarterSeasonProfile | undefined, minimumGames = 10): ShareEstimate {
  const currentGames = current?.scored.SEASON.games ?? 0;
  const previousGames = previous?.scored.SEASON.games ?? 0;
  if (current && currentGames >= minimumGames && current.fullGamePoints > 0) return { share: current.threeQuarterPoints / current.fullGamePoints, source: "current season", games: currentGames };
  const pooledThree = (current?.threeQuarterPoints ?? 0) + (previous?.threeQuarterPoints ?? 0);
  const pooledFull = (current?.fullGamePoints ?? 0) + (previous?.fullGamePoints ?? 0);
  if (pooledFull <= 0) return { share: null, source: "none", games: 0 };
  const source = currentGames > 0 && previousGames > 0 ? "current + last season" : currentGames > 0 ? "current season" : "last season"; // early season leans on last year
  return { share: pooledThree / pooledFull, source, games: currentGames + previousGames };
}

export function pickDeviation(current: ThreeQuarterSeasonProfile | undefined, previous: ThreeQuarterSeasonProfile | undefined): number {
  const currentDeviation = current?.scored.SEASON.standardDeviation ?? null;
  if (currentDeviation !== null && (current?.scored.SEASON.games ?? 0) >= 8) return currentDeviation;
  const previousDeviation = previous?.scored.SEASON.standardDeviation ?? null;
  return previousDeviation ?? currentDeviation ?? appSettings.defaultTeamThreeQuarterSd;
}

export interface ThreeQuarterProjection {
  projection: number | null;
  probability: number | null;
  standardDeviation: number;
}

export function projectThreeQuarters(impliedTeamTotal: number | null, threeQuarterShare: number | null, standardDeviation: number, target = appSettings.hundredThroughThreeTarget): ThreeQuarterProjection {
  if (impliedTeamTotal === null || threeQuarterShare === null) return { projection: null, probability: null, standardDeviation };
  const projection = impliedTeamTotal * threeQuarterShare;
  return { projection, probability: probabilityAtLeast(target, projection, standardDeviation), standardDeviation }; // P(points >= 100) with continuity correction
}
