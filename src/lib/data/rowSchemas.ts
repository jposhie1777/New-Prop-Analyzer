export type DuckColumnType = "INTEGER" | "DOUBLE" | "VARCHAR" | "BOOLEAN";

export const countingStatFields = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "turnover", "pf", "pts", "plus_minus"] as const;
export const percentStatFields = ["fg_pct", "fg3_pct", "ft_pct"] as const;

export const advancedMetricFields = [
  "pie", "assist_percentage", "assist_ratio", "assist_to_turnover", "defensive_rating", "defensive_rebound_percentage", "effective_field_goal_percentage",
  "estimated_defensive_rating", "estimated_net_rating", "estimated_offensive_rating", "estimated_pace", "estimated_usage_percentage", "net_rating",
  "offensive_rating", "offensive_rebound_percentage", "pace", "pace_per_40", "possessions", "rebound_percentage", "true_shooting_percentage",
  "turnover_ratio", "usage_percentage", "blocks_against", "fouls_drawn", "points_fast_break", "points_off_turnovers", "points_paint",
  "points_second_chance", "opp_points_fast_break", "opp_points_off_turnovers", "opp_points_paint", "opp_points_second_chance", "pct_assisted_2pt",
  "pct_assisted_3pt", "pct_assisted_fgm", "pct_fga_2pt", "pct_fga_3pt", "pct_pts_2pt", "pct_pts_3pt", "pct_pts_fast_break", "pct_pts_free_throw",
  "pct_pts_midrange_2pt", "pct_pts_off_turnovers", "pct_pts_paint", "pct_unassisted_2pt", "pct_unassisted_3pt", "pct_unassisted_fgm",
  "four_factors_efg_pct", "free_throw_attempt_rate", "four_factors_oreb_pct", "opp_efg_pct", "opp_free_throw_attempt_rate", "opp_oreb_pct",
  "opp_turnover_pct", "team_turnover_pct", "box_outs", "box_out_player_rebounds", "box_out_player_team_rebounds", "defensive_box_outs",
  "offensive_box_outs", "charges_drawn", "contested_shots", "contested_shots_2pt", "contested_shots_3pt", "deflections", "loose_balls_recovered_def",
  "loose_balls_recovered_off", "loose_balls_recovered_total", "screen_assists", "screen_assist_points", "matchup_minutes", "matchup_fg_pct",
  "matchup_fga", "matchup_fgm", "matchup_3pt_pct", "matchup_3pa", "matchup_3pm", "matchup_assists", "matchup_turnovers", "partial_possessions",
  "matchup_player_points", "switches_on", "speed", "distance", "touches", "passes", "secondary_assists", "free_throw_assists", "contested_fga",
  "contested_fgm", "contested_fg_pct", "uncontested_fga", "uncontested_fgm", "uncontested_fg_pct", "defended_at_rim_fga", "defended_at_rim_fgm",
  "defended_at_rim_fg_pct", "rebound_chances_def", "rebound_chances_off", "rebound_chances_total", "pct_blocks", "pct_blocks_allowed", "pct_fga",
  "pct_fgm", "pct_fta", "pct_ftm", "pct_personal_fouls", "pct_personal_fouls_drawn", "pct_points", "pct_rebounds_def", "pct_rebounds_off",
  "pct_rebounds_total", "pct_steals", "pct_3pa", "pct_3pm", "pct_turnovers",
] as const; // numeric fields of NBAAdvancedStatsV2 in the spec, matchup_minutes converted to minutes

const statLineColumns: Record<string, DuckColumnType> = {
  season: "INTEGER",
  game_date: "VARCHAR",
  game_id: "INTEGER",
  player_id: "INTEGER",
  team_id: "INTEGER",
  opponent_team_id: "INTEGER",
  is_home: "BOOLEAN",
  minutes: "DOUBLE",
  ...Object.fromEntries(countingStatFields.map((fieldName) => [fieldName, "DOUBLE" as const])),
  ...Object.fromEntries(percentStatFields.map((fieldName) => [fieldName, "DOUBLE" as const])),
};

export const tableColumns = {
  games: {
    game_id: "INTEGER",
    season: "INTEGER",
    game_date: "VARCHAR",
    tipoff: "VARCHAR",
    status: "VARCHAR",
    status_state: "VARCHAR",
    postseason: "BOOLEAN",
    home_team_id: "INTEGER",
    visitor_team_id: "INTEGER",
    home_score: "INTEGER",
    visitor_score: "INTEGER",
    periods_played: "INTEGER",
  },
  teams: {
    team_id: "INTEGER",
    abbreviation: "VARCHAR",
    city: "VARCHAR",
    name: "VARCHAR",
    full_name: "VARCHAR",
    conference: "VARCHAR",
    division: "VARCHAR",
  },
  players: {
    player_id: "INTEGER",
    first_name: "VARCHAR",
    last_name: "VARCHAR",
    position: "VARCHAR",
    jersey_number: "VARCHAR",
    team_id: "INTEGER",
    last_seen_date: "VARCHAR",
  },
  player_game_stats: statLineColumns,
  player_period_stats: { ...statLineColumns, period: "INTEGER" },
  advanced_stats: {
    season: "INTEGER",
    game_date: "VARCHAR",
    game_id: "INTEGER",
    player_id: "INTEGER",
    team_id: "INTEGER",
    period: "INTEGER",
    ...Object.fromEntries(advancedMetricFields.map((fieldName) => [fieldName, "DOUBLE" as const])),
  },
  lineups: {
    season: "INTEGER",
    game_date: "VARCHAR",
    game_id: "INTEGER",
    player_id: "INTEGER",
    team_id: "INTEGER",
    starter: "BOOLEAN",
    position: "VARCHAR",
  },
  team_period_summaries: {
    season: "INTEGER",
    game_date: "VARCHAR",
    game_id: "INTEGER",
    team_id: "INTEGER",
    opponent_team_id: "INTEGER",
    is_home: "BOOLEAN",
    period: "INTEGER",
    period_minutes: "DOUBLE",
    points: "DOUBLE",
    opp_points: "DOUBLE",
    field_goal_attempts: "DOUBLE",
    free_throw_attempts: "DOUBLE",
    offensive_rebounds: "DOUBLE",
    turnovers: "DOUBLE",
    possessions: "DOUBLE",
    opp_possessions: "DOUBLE",
    pace: "DOUBLE",
    possessions_source: "VARCHAR",
  },
  shot_zones: {
    season: "INTEGER",
    game_date: "VARCHAR",
    game_id: "INTEGER",
    player_id: "INTEGER",
    team_id: "INTEGER",
    opponent_team_id: "INTEGER",
    zone: "VARCHAR",
    attempts: "INTEGER",
    makes: "INTEGER",
  },
} satisfies Record<string, Record<string, DuckColumnType>>;

export type TableName = keyof typeof tableColumns;
export const tableNames = Object.keys(tableColumns) as TableName[];
export type DataRow = Record<string, string | number | boolean | null>;

export type FinalsTables = Record<Exclude<TableName, "teams">, DataRow[]>;

export interface FinalsPayload {
  date: string;
  complete: boolean;
  generatedAt: string;
  bdlCalls: number;
  tables: FinalsTables;
  warnings: string[];
}

export function createTableSql(tableName: TableName, qualifiedName: string = tableName): string {
  const columnDefinitions = Object.entries(tableColumns[tableName]).map(([columnName, columnType]) => `"${columnName}" ${columnType}`);
  return `CREATE TABLE IF NOT EXISTS ${qualifiedName} (${columnDefinitions.join(", ")})`;
}

export function jsonColumnsSpec(tableName: TableName): string {
  const columnPairs = Object.entries(tableColumns[tableName]).map(([columnName, columnType]) => `'${columnName}': '${columnType}'`);
  return `{${columnPairs.join(", ")}}`; // read_json columns={...} argument
}

export function selectColumnsSql(tableName: TableName): string {
  return Object.entries(tableColumns[tableName]).map(([columnName, columnType]) => `TRY_CAST("${columnName}" AS ${columnType}) AS "${columnName}"`).join(", ");
}

export function emptyFinalsTables(): FinalsTables {
  return { games: [], players: [], player_game_stats: [], player_period_stats: [], advanced_stats: [], lineups: [], team_period_summaries: [], shot_zones: [] };
}
