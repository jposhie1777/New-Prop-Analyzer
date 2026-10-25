export type CompetitionStatusState =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled"
  | "delayed"
  | "suspended"
  | "abandoned"
  | "unknown";

export type SeasonType = "preseason" | "regular" | "ist" | "playin" | "playoffs";

export interface BdlPagination {
  next_cursor?: number | null;
  prev_cursor?: number | null;
  per_page: number;
}

export interface BdlListResponse<ItemType> {
  data: ItemType[];
  meta?: BdlPagination;
}

export interface BdlSingleResponse<ItemType> {
  data: ItemType;
}

export interface BdlTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface BdlPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team?: BdlTeam;
  team_id?: number;
}

export interface BdlGameScoreDetail {
  home_q1?: number | null;
  home_q2?: number | null;
  home_q3?: number | null;
  home_q4?: number | null;
  home_ot1?: number | null;
  home_ot2?: number | null;
  home_ot3?: number | null;
  home_timeouts_remaining?: number | null;
  home_in_bonus?: boolean | null;
  visitor_q1?: number | null;
  visitor_q2?: number | null;
  visitor_q3?: number | null;
  visitor_q4?: number | null;
  visitor_ot1?: number | null;
  visitor_ot2?: number | null;
  visitor_ot3?: number | null;
  visitor_timeouts_remaining?: number | null;
  visitor_in_bonus?: boolean | null;
}

export interface BdlGame extends BdlGameScoreDetail {
  id: number;
  date: string;
  season: number;
  status: string | null;
  status_state?: CompetitionStatusState;
  period: number | null;
  time: string | null;
  period_detail?: string | null;
  datetime: string | null;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: BdlTeam;
  visitor_team: BdlTeam;
  ist_stage?: string | null;
}

export interface BdlStatLine {
  min: string | null;
  fgm: number | null;
  fga: number | null;
  fg_pct: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fg3_pct: number | null;
  ftm: number | null;
  fta: number | null;
  ft_pct: number | null;
  oreb: number | null;
  dreb: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  turnover: number | null;
  pf: number | null;
  pts: number | null;
  plus_minus?: number | null;
}

export interface BdlStats extends BdlStatLine {
  id: number;
  player: BdlPlayer;
  team: BdlTeam;
  game: BdlGame;
}

export interface BdlBoxScorePlayer extends BdlStatLine {
  player: BdlPlayer;
}

export interface BdlBoxScoreTeam {
  team: BdlTeam;
  players: BdlBoxScorePlayer[];
}

export interface BdlBoxScore extends BdlGameScoreDetail {
  date: string;
  season: number;
  status: string;
  status_state?: CompetitionStatusState;
  period: number;
  time: string;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: BdlBoxScoreTeam;
  visitor_team: BdlBoxScoreTeam;
}

export interface BdlLineup {
  id: number;
  game_id: number;
  starter: boolean;
  position: string | null;
  player: BdlPlayer;
  team: BdlTeam;
}

export interface BdlPlay {
  game_id: number;
  order: number;
  type: string;
  text: string;
  home_score: number;
  away_score: number;
  period: number;
  period_display: string;
  clock: string;
  scoring_play: boolean;
  shooting_play: boolean;
  score_value: number;
  team: BdlTeam | null;
  coordinate_x?: number | null;
  coordinate_y?: number | null;
  wallclock?: string | null;
  participants?: number[];
}

export interface BdlPlayerInjury {
  player: BdlPlayer;
  return_date: string | null;
  description: string | null;
  status: string;
}

export interface BdlDeeplink {
  url?: string | null;
  url_template?: string | null;
}

export interface BdlDeeplinks {
  event?: BdlDeeplink | null;
  selections?: Record<string, BdlDeeplink | null>;
}

export interface BdlBettingOdd {
  id: number;
  game_id: number;
  vendor: string;
  spread_home_value: string | null;
  spread_home_odds: number | null;
  spread_away_value: string | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
  updated_at?: string;
  opened_at?: string;
  deeplinks?: BdlDeeplinks | null;
}

export interface BdlPropMarketOverUnder {
  type: "over_under";
  over_odds: number;
  under_odds: number;
}

export interface BdlPropMarketMilestone {
  type: "milestone";
  odds: number;
}

export interface BdlPlayerProp {
  id: number;
  game_id: number;
  player_id: number;
  vendor: string;
  prop_type: string;
  line_value: string;
  market: BdlPropMarketOverUnder | BdlPropMarketMilestone;
  updated_at?: string;
  opened_at?: string;
  deeplinks?: BdlDeeplinks | null;
}

export interface BdlAdvancedStatsV2 {
  id: number;
  period?: number | null;
  player: BdlPlayer;
  team: BdlTeam;
  game: BdlGame;
  [metricName: string]: unknown;
}
