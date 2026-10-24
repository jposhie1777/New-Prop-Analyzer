export const scopeNames = ["FG", "Q1", "Q2", "Q3", "Q4", "H1", "H2", "T3"] as const;
export type ScopeName = (typeof scopeNames)[number];

export const scopeLabels: Record<ScopeName, string> = {
  FG: "Full game",
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4",
  H1: "1st half",
  H2: "2nd half",
  T3: "Thru 3Q",
};

export const playerStatColumns = ["pts", "reb", "ast", "fg3m", "stl", "blk", "turnover", "oreb", "dreb", "fgm", "fga", "fg3a", "ftm", "fta", "pf", "plus_minus"] as const;
export const playerComboColumns = ["pra", "pr", "pa", "ra", "stocks"] as const;
export const playerMetricColumns = ["minutes", ...playerStatColumns, ...playerComboColumns] as const;
export type PlayerMetric = (typeof playerMetricColumns)[number];

export const playerMetricLabels: Record<PlayerMetric, string> = {
  minutes: "MIN", pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", stl: "STL", blk: "BLK", turnover: "TOV", oreb: "OREB", dreb: "DREB",
  fgm: "FGM", fga: "FGA", fg3a: "3PA", ftm: "FTM", fta: "FTA", pf: "PF", plus_minus: "+/-", pra: "PRA", pr: "PR", pa: "PA", ra: "RA", stocks: "STL+BLK",
};

export function positionGroupSql(positionExpression: string): string {
  const upperPosition = `upper(trim(coalesce(${positionExpression}, '')))`;
  return `CASE WHEN ${upperPosition} IN ('PG', 'SG') OR ${upperPosition} LIKE 'G%' THEN 'G' WHEN ${upperPosition} IN ('SF', 'PF') OR ${upperPosition} LIKE 'F%' THEN 'F' WHEN ${upperPosition} LIKE 'C%' THEN 'C' ELSE NULL END`; // PG/SG -> G, SF/PF -> F, else first letter
}

const statSums = ["minutes", ...playerStatColumns].map((columnName) => `SUM("${columnName}") AS "${columnName}"`).join(", ");
const statList = ["minutes", ...playerStatColumns].map((columnName) => `"${columnName}"`).join(", ");
const lineIdentity = "season, game_date, game_id, player_id, team_id, opponent_team_id, is_home";

function periodGroupSelect(scopeName: string, periods: number[]): string {
  return `SELECT season, game_date, game_id, player_id, any_value(team_id) AS team_id, any_value(opponent_team_id) AS opponent_team_id, any_value(is_home) AS is_home, '${scopeName}' AS scope, ${statSums}
    FROM player_period_stats WHERE period IN (${periods.join(", ")}) GROUP BY season, game_date, game_id, player_id`;
}

function teamScopeSelect(scopeName: string, periodFilter: string): string {
  return `SELECT season, game_date, game_id, team_id, opponent_team_id, is_home, '${scopeName}' AS scope, SUM(points) AS points, SUM(opp_points) AS opp_points,
    SUM(possessions) AS possessions, SUM(opp_possessions) AS opp_possessions, SUM(period_minutes) AS minutes, COUNT(*) AS period_count
    FROM team_period_summaries WHERE ${periodFilter} GROUP BY season, game_date, game_id, team_id, opponent_team_id, is_home`;
}

export const analyticsViewStatements: string[] = [
  `CREATE OR REPLACE TABLE players_latest AS SELECT * FROM players QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY last_seen_date DESC NULLS LAST) = 1`,
  `CREATE OR REPLACE TABLE player_scope_lines AS
    WITH scope_base AS (
      SELECT ${lineIdentity}, 'FG' AS scope, ${statList} FROM player_game_stats
      UNION ALL SELECT ${lineIdentity}, 'Q' || CAST(period AS VARCHAR) AS scope, ${statList} FROM player_period_stats WHERE period BETWEEN 1 AND 4
      UNION ALL ${periodGroupSelect("H1", [1, 2])}
      UNION ALL ${periodGroupSelect("H2", [3, 4])}
      UNION ALL ${periodGroupSelect("T3", [1, 2, 3])}
    )
    SELECT *, pts + reb + ast AS pra, pts + reb AS pr, pts + ast AS pa, reb + ast AS ra, stl + blk AS stocks FROM scope_base`,
  `CREATE OR REPLACE TABLE team_scope_lines AS
    ${teamScopeSelect("FG", "TRUE")}
    UNION ALL ${teamScopeSelect("H1", "period IN (1, 2)")}
    UNION ALL ${teamScopeSelect("H2", "period IN (3, 4)")}
    UNION ALL ${teamScopeSelect("T3", "period IN (1, 2, 3)")}
    UNION ALL SELECT season, game_date, game_id, team_id, opponent_team_id, is_home, 'Q' || CAST(period AS VARCHAR) AS scope, points, opp_points, possessions, opp_possessions, period_minutes AS minutes, 1 AS period_count
      FROM team_period_summaries WHERE period BETWEEN 1 AND 4`,
  `CREATE OR REPLACE TABLE player_game_positions AS
    SELECT stat_line.game_id, stat_line.player_id, stat_line.team_id,
      COALESCE(${positionGroupSql("lineup_row.position")}, ${positionGroupSql("player_row.position")}, 'F') AS position_group
    FROM player_game_stats AS stat_line
    LEFT JOIN (SELECT game_id, player_id, any_value(position) AS position FROM lineups GROUP BY game_id, player_id) AS lineup_row
      ON lineup_row.game_id = stat_line.game_id AND lineup_row.player_id = stat_line.player_id
    LEFT JOIN players_latest AS player_row ON player_row.player_id = stat_line.player_id`,
];
