import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber } from "@/lib/analytics/engine";
import type { ScopeName } from "@/lib/analytics/views";
import { rankDescending, readWindowSummary, windowNames, windowedAggregateColumns, type MetricSummary, type WindowName } from "./windows";

export const positionGroups = ["G", "F", "C"] as const;
export type PositionGroup = (typeof positionGroups)[number];
export const defenseScopes: ScopeName[] = ["FG", "Q1", "Q2", "Q3", "Q4"];
export const defenseMetrics = ["pts", "reb", "ast", "fg3m", "stl", "blk", "turnover", "pra", "minutes"] as const;
export type DefenseMetric = (typeof defenseMetrics)[number];

export interface DefenseCell extends MetricSummary {
  rank: number | null; // 1 = allows the most (softest matchup), 30 = allows the least
}

export type DefenseTable = Record<number, Partial<Record<ScopeName, Record<PositionGroup, Record<WindowName, Record<DefenseMetric, DefenseCell>>>>>>;

export async function defenseVsPosition(engine: AnalyticsEngine, season: number): Promise<DefenseTable> {
  const metricSums = defenseMetrics.map((metricName) => `COALESCE(SUM(grouped_line."${metricName}"), 0) AS "${metricName}"`).join(", ");
  const aggregateRows = await engine.query<Record<string, unknown>>(`
    WITH defense_games AS (
      SELECT DISTINCT season, game_date, game_id, opponent_team_id AS defense_team_id, scope FROM player_scope_lines
      WHERE season = ${sqlNumber(season)} AND scope IN (${defenseScopes.map((scopeName) => `'${scopeName}'`).join(", ")})
    ),
    game_grid AS (
      SELECT defense_games.*, group_list.position_group FROM defense_games CROSS JOIN (SELECT UNNEST(['G', 'F', 'C']) AS position_group) AS group_list
    ),
    allowed AS (
      SELECT game_grid.season, game_grid.game_date, game_grid.game_id, game_grid.defense_team_id, game_grid.scope, game_grid.position_group, ${metricSums}
      FROM game_grid
      LEFT JOIN (
        SELECT scope_line.*, position_row.position_group AS player_group FROM player_scope_lines AS scope_line
        JOIN player_game_positions AS position_row ON position_row.game_id = scope_line.game_id AND position_row.player_id = scope_line.player_id
        WHERE scope_line.season = ${sqlNumber(season)}
      ) AS grouped_line
        ON grouped_line.game_id = game_grid.game_id AND grouped_line.opponent_team_id = game_grid.defense_team_id
        AND grouped_line.scope = game_grid.scope AND grouped_line.player_group = game_grid.position_group
      GROUP BY ALL
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY defense_team_id, scope, position_group ORDER BY game_date DESC, game_id DESC) AS recency FROM allowed
    )
    SELECT defense_team_id, scope, position_group, ${windowedAggregateColumns(defenseMetrics, false).join(", ")}
    FROM ranked GROUP BY defense_team_id, scope, position_group`); // totals allowed to each opposing G/F/C group per game
  return rankDefenseRows(aggregateRows);
}

export function rankDefenseRows(aggregateRows: Array<Record<string, unknown>>): DefenseTable {
  const table: DefenseTable = {};
  for (const aggregateRow of aggregateRows) {
    const teamId = Number(aggregateRow.defense_team_id);
    const scope = aggregateRow.scope as ScopeName;
    const positionGroup = aggregateRow.position_group as PositionGroup;
    table[teamId] ??= {};
    table[teamId][scope] ??= {} as Record<PositionGroup, Record<WindowName, Record<DefenseMetric, DefenseCell>>>;
    const windowsForGroup = {} as Record<WindowName, Record<DefenseMetric, DefenseCell>>;
    for (const windowName of windowNames) {
      windowsForGroup[windowName] = {} as Record<DefenseMetric, DefenseCell>;
      for (const metricName of defenseMetrics) windowsForGroup[windowName][metricName] = { ...readWindowSummary(aggregateRow, metricName, windowName), rank: null };
    }
    table[teamId][scope]![positionGroup] = windowsForGroup;
  }
  for (const scope of defenseScopes) {
    for (const positionGroup of positionGroups) {
      for (const windowName of windowNames) {
        for (const metricName of defenseMetrics) {
          const cells = Object.values(table).map((teamEntry) => teamEntry[scope]?.[positionGroup]?.[windowName]?.[metricName]).filter((cell): cell is DefenseCell => Boolean(cell));
          const ranks = rankDescending(cells, (cell) => cell.average);
          for (const cell of cells) cell.rank = ranks.get(cell) ?? null;
        }
      }
    }
  }
  return table;
}
