import { easternDateOf } from "@/lib/dates";

export interface NcaabTeam {
  id: number;
  conference_id: number | null;
  name: string; // "Blue Devils"
  full_name: string; // "Duke Blue Devils"
  college: string; // "Duke"
  abbreviation: string;
}

export interface NcaabConference {
  id: number;
  name: string;
  short_name: string | null;
}

export interface NcaabGame {
  id: number;
  date: string; // ISO date-time of tip-off
  season: number; // 2025 = the 2025-26 season
  postseason: boolean;
  status: string;
  status_state?: string | null;
  period: number | null;
  period_detail?: string | null;
  home_team: NcaabTeam;
  visitor_team: NcaabTeam;
  home_score: number | null;
  away_score: number | null;
}

export interface NcaabPlay {
  game_id: number;
  order: number;
  type: string | null;
  text: string | null;
  home_score: number | null;
  away_score: number | null;
  period: number | null;
  clock: string | null;
  scoring_play: boolean | null;
  score_value: number | null;
  team: { id: number } | null;
}

export interface NcaabPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position?: string | null;
  team?: NcaabTeam | null;
}

export interface NcaabRanking {
  poll_id?: number | string | null;
  poll?: string | null;
  team: NcaabTeam;
  season: number;
  week: number;
  rank: number;
  first_place_votes: number | null;
  trend: string | null;
  points: number | null;
  record: string | null;
}

export interface NcaabStanding {
  team: NcaabTeam;
  conference: NcaabConference | null;
  season: number;
  wins: number;
  losses: number;
  conference_record: string | null;
}

export function isNcaabFinal(game: Pick<NcaabGame, "status" | "status_state">): boolean {
  if (game.status_state) return game.status_state === "final";
  return /final/i.test(game.status ?? "");
}

export function isNcaabLive(game: Pick<NcaabGame, "status" | "status_state">): boolean {
  if (game.status_state) return game.status_state === "in_progress";
  return /half|1st|2nd|\bot\b|overtime/i.test(game.status ?? "") && !isNcaabFinal(game);
}

export function ncaabSeasonFor(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number);
  return month >= 10 ? year : year - 1; // 2025 = the 2025-26 season, which tips off in November
}

export function ncaabGameDate(game: Pick<NcaabGame, "date">): string {
  if (!game.date.includes("T")) return game.date.slice(0, 10);
  return easternDateOf(new Date(game.date)); // tip times are UTC; the slate day is Eastern
}
