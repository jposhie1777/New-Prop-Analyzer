import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlNumberList, sqlString } from "@/lib/analytics/engine";
import { playerMetricColumns, scopeNames, type PlayerMetric, type ScopeName } from "@/lib/analytics/views";
import { readWindowSummary, windowNames, windowedAggregateColumns, type MetricSummary, type WindowName } from "./windows";
import { propMapping } from "@/lib/analytics/propTypes";
import { hitRate } from "@/lib/math/probability";

export type PlayerWindowTable = Record<number, Partial<Record<ScopeName, Record<WindowName, Record<PlayerMetric, MetricSummary>>>>>;

export interface PlayerProfile {
  player_id: number;
  first_name: string;
  last_name: string;
  position: string;
  team_id: number | null;
  jersey_number: string | null;
}

export async function findPlayer(engine: AnalyticsEngine, playerId: number): Promise<PlayerProfile | null> {
  const [profileRow] = await engine.query<PlayerProfile>(`SELECT player_id, first_name, last_name, position, team_id, jersey_number FROM players_latest WHERE player_id = ${sqlNumber(playerId)}`);
  return profileRow ?? null;
}

export async function searchPlayers(engine: AnalyticsEngine, searchText: string, limit = 20): Promise<Array<PlayerProfile & { games: number }>> {
  const pattern = sqlString(`%${searchText.toLowerCase()}%`);
  return engine.query(`
    SELECT player_row.player_id, player_row.first_name, player_row.last_name, player_row.position, player_row.team_id, player_row.jersey_number, COUNT(stat_line.game_id) AS games
    FROM players_latest AS player_row LEFT JOIN player_game_stats AS stat_line ON stat_line.player_id = player_row.player_id
    WHERE lower(player_row.first_name || ' ' || player_row.last_name) LIKE ${pattern}
    GROUP BY ALL ORDER BY games DESC, player_row.last_name LIMIT ${sqlNumber(limit)}`);
}

function playedGamesSql(playerId: number, seasons: number[]): string {
  return `played AS (
      SELECT season, game_id, game_date, ROW_NUMBER() OVER (PARTITION BY season ORDER BY game_date DESC, game_id DESC) AS recency
      FROM player_game_stats WHERE player_id = ${sqlNumber(playerId)} AND minutes > 0 AND season IN (${sqlNumberList(seasons)})
    ),
    period_games AS (SELECT DISTINCT game_id FROM player_period_stats),
    scope_grid AS (
      SELECT played.*, scope_list.scope FROM played CROSS JOIN (SELECT UNNEST([${scopeNames.map((scopeName) => `'${scopeName}'`).join(", ")}]) AS scope) AS scope_list
      WHERE scope_list.scope = 'FG' OR played.game_id IN (SELECT game_id FROM period_games)
    ),
    filled AS (
      SELECT scope_grid.season, scope_grid.scope, scope_grid.recency, ${playerMetricColumns.map((metricName) => `COALESCE(scope_line."${metricName}", 0) AS "${metricName}"`).join(", ")}
      FROM scope_grid LEFT JOIN player_scope_lines AS scope_line
        ON scope_line.player_id = ${sqlNumber(playerId)} AND scope_line.game_id = scope_grid.game_id AND scope_line.scope = scope_grid.scope
    )`; // a quarter the player sat out counts as zero, games without period data are skipped
}

export async function playerWindowAggregates(engine: AnalyticsEngine, playerId: number, seasons: number[]): Promise<PlayerWindowTable> {
  const aggregateRows = await engine.query<Record<string, unknown>>(`
    WITH ${playedGamesSql(playerId, seasons)}
    SELECT season, scope, ${windowedAggregateColumns(playerMetricColumns).join(", ")}
    FROM filled GROUP BY season, scope`);
  const table: PlayerWindowTable = {};
  for (const aggregateRow of aggregateRows) {
    const season = Number(aggregateRow.season);
    const scope = aggregateRow.scope as ScopeName;
    table[season] ??= {};
    const windowsForScope = {} as Record<WindowName, Record<PlayerMetric, MetricSummary>>;
    for (const windowName of windowNames) {
      windowsForScope[windowName] = {} as Record<PlayerMetric, MetricSummary>;
      for (const metricName of playerMetricColumns) windowsForScope[windowName][metricName] = readWindowSummary(aggregateRow, metricName, windowName);
    }
    table[season][scope] = windowsForScope;
  }
  return table;
}

export interface PlayerGameLogRow {
  season: number;
  game_id: number;
  game_date: string;
  team_id: number;
  opponent_team_id: number;
  is_home: boolean;
  scope: ScopeName;
  [metricName: string]: unknown;
}

export async function playerGameLog(engine: AnalyticsEngine, playerId: number, season: number): Promise<PlayerGameLogRow[]> {
  return engine.query<PlayerGameLogRow>(`
    SELECT scope_line.*, game_row.home_score, game_row.visitor_score
    FROM player_scope_lines AS scope_line JOIN games AS game_row ON game_row.game_id = scope_line.game_id
    WHERE scope_line.player_id = ${sqlNumber(playerId)} AND scope_line.season = ${sqlNumber(season)}
    ORDER BY scope_line.game_date DESC, scope_line.scope`);
}

export interface RecentValueRow {
  game_id: number;
  game_date: string;
  scope: ScopeName;
  values: Partial<Record<PlayerMetric, number>>;
}

export async function playerRecentSeries(engine: AnalyticsEngine, playerId: number, scopes: ScopeName[], gameLimit = 20): Promise<Map<ScopeName, Array<Record<PlayerMetric, number>>>> {
  const seriesRows = await engine.query<Record<string, unknown>>(`
    WITH recent AS (
      SELECT game_id, game_date FROM player_game_stats WHERE player_id = ${sqlNumber(playerId)} AND minutes > 0
      ORDER BY game_date DESC, game_id DESC LIMIT ${sqlNumber(gameLimit)}
    )
    SELECT recent.game_date, scope_line.* EXCLUDE (game_date)
    FROM recent JOIN player_scope_lines AS scope_line ON scope_line.game_id = recent.game_id AND scope_line.player_id = ${sqlNumber(playerId)}
    WHERE scope_line.scope IN (${scopes.map((scopeName) => sqlString(scopeName)).join(", ")})
    ORDER BY recent.game_date DESC, recent.game_id DESC`); // most recent games across seasons, newest first
  const seriesByScope = new Map<ScopeName, Array<Record<PlayerMetric, number>>>();
  for (const seriesRow of seriesRows) {
    const scope = seriesRow.scope as ScopeName;
    const metricValues = {} as Record<PlayerMetric, number>;
    for (const metricName of playerMetricColumns) metricValues[metricName] = Number(seriesRow[metricName] ?? 0);
    seriesByScope.set(scope, [...(seriesByScope.get(scope) ?? []), metricValues]);
  }
  return seriesByScope;
}

export interface PropLineInput {
  propType: string;
  lineValue: number;
}

export interface HitRateResult {
  propType: string;
  lineValue: number;
  metric: PlayerMetric;
  scope: ScopeName;
  windows: Record<"L5" | "L10" | "L20", { hitRate: number | null; games: number; hits: number }>;
}

export function computeHitRates(seriesByScope: Map<ScopeName, Array<Record<PlayerMetric, number>>>, propLines: PropLineInput[]): HitRateResult[] {
  const results: HitRateResult[] = [];
  for (const propLine of propLines) {
    const mapping = propMapping(propLine.propType);
    if (!mapping) continue;
    const series = (seriesByScope.get(mapping.scope) ?? []).map((metricValues) => metricValues[mapping.metric]);
    const windows = {} as HitRateResult["windows"];
    for (const [windowName, windowSize] of [["L5", 5], ["L10", 10], ["L20", 20]] as const) {
      const windowValues = series.slice(0, windowSize);
      windows[windowName] = { hitRate: hitRate(windowValues, propLine.lineValue), games: windowValues.length, hits: windowValues.filter((value) => value > propLine.lineValue).length };
    }
    results.push({ propType: propLine.propType, lineValue: propLine.lineValue, metric: mapping.metric, scope: mapping.scope, windows });
  }
  return results;
}

export async function playerHitRates(engine: AnalyticsEngine, playerId: number, propLines: PropLineInput[]): Promise<HitRateResult[]> {
  const neededScopes = [...new Set(propLines.map((propLine) => propMapping(propLine.propType)?.scope).filter((scopeName): scopeName is ScopeName => Boolean(scopeName)))];
  if (neededScopes.length === 0) return [];
  return computeHitRates(await playerRecentSeries(engine, playerId, neededScopes, 20), propLines);
}

export async function playerPositionGroup(engine: AnalyticsEngine, playerId: number): Promise<"G" | "F" | "C"> {
  const [groupRow] = await engine.query<{ position_group: "G" | "F" | "C" }>(`
    WITH recent AS (
      SELECT position_row.position_group FROM player_game_positions AS position_row
      JOIN player_game_stats AS stat_line ON stat_line.game_id = position_row.game_id AND stat_line.player_id = position_row.player_id
      WHERE position_row.player_id = ${sqlNumber(playerId)} ORDER BY stat_line.game_date DESC LIMIT 20
    )
    SELECT position_group FROM recent GROUP BY position_group ORDER BY COUNT(*) DESC LIMIT 1`); // most common recent group
  return groupRow?.position_group ?? "F";
}

export interface SecondHalfProfile {
  playerId: number;
  games: number;
  metrics: Record<PlayerMetric, { average: number | null; standardDeviation: number | null }>;
}

export async function secondHalfProfiles(engine: AnalyticsEngine, playerIds: number[], gameLimit = 10): Promise<Map<number, SecondHalfProfile>> {
  const profiles = new Map<number, SecondHalfProfile>();
  if (playerIds.length === 0) return profiles;
  const metricColumns = playerMetricColumns.flatMap((metricName) => [`AVG(COALESCE(half_line."${metricName}", 0)) AS "${metricName}__avg"`, `STDDEV_SAMP(COALESCE(half_line."${metricName}", 0)) AS "${metricName}__sd"`]);
  const profileRows = await engine.query<Record<string, unknown>>(`
    WITH recent AS (
      SELECT player_id, game_id, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC, game_id DESC) AS recency
      FROM player_game_stats WHERE player_id IN (${sqlNumberList(playerIds)}) AND minutes > 0
        AND game_id IN (SELECT DISTINCT game_id FROM player_period_stats)
    )
    SELECT recent.player_id, COUNT(*) AS games, ${metricColumns.join(", ")}
    FROM recent LEFT JOIN player_scope_lines AS half_line ON half_line.player_id = recent.player_id AND half_line.game_id = recent.game_id AND half_line.scope = 'H2'
    WHERE recent.recency <= ${sqlNumber(gameLimit)}
    GROUP BY recent.player_id`); // last N games across seasons, a benched 2nd half counts as zero
  for (const profileRow of profileRows) {
    const metrics = {} as SecondHalfProfile["metrics"];
    for (const metricName of playerMetricColumns) {
      const averageValue = profileRow[`${metricName}__avg`];
      const deviationValue = profileRow[`${metricName}__sd`];
      metrics[metricName] = {
        average: typeof averageValue === "number" && Number.isFinite(averageValue) ? averageValue : null,
        standardDeviation: typeof deviationValue === "number" && Number.isFinite(deviationValue) ? deviationValue : null,
      };
    }
    profiles.set(Number(profileRow.player_id), { playerId: Number(profileRow.player_id), games: Number(profileRow.games), metrics });
  }
  return profiles;
}
