import type { BdlAdvancedStatsV2, BdlGame, BdlLineup, BdlPlayer, BdlStats, BdlTeam } from "@/lib/bdl/types";
import { advancedMetricFields, countingStatFields, percentStatFields, type DataRow } from "./rowSchemas";
import { parseMinutes } from "@/lib/dates";

export function isGameFinal(game: Pick<BdlGame, "status" | "status_state">): boolean {
  if (game.status_state) return game.status_state === "final";
  return (game.status ?? "").toLowerCase().startsWith("final"); // older responses without status_state
}

export function isGameLive(game: Pick<BdlGame, "status" | "status_state">): boolean {
  if (game.status_state) return game.status_state === "in_progress";
  const status = (game.status ?? "").toLowerCase();
  return /qtr|half|ot|end of/.test(status) && !status.startsWith("final");
}

export function isHalftime(game: Pick<BdlGame, "status" | "time" | "period">): boolean {
  const statusText = `${game.status ?? ""} ${game.time ?? ""}`.toLowerCase();
  return statusText.includes("halftime") || (statusText.includes("half") && (game.period ?? 0) === 2);
}

export function flattenGame(game: BdlGame): DataRow {
  return {
    game_id: game.id,
    season: game.season,
    game_date: game.date,
    tipoff: game.datetime ?? null,
    status: game.status ?? null,
    status_state: game.status_state ?? (isGameFinal(game) ? "final" : "unknown"),
    postseason: game.postseason,
    home_team_id: game.home_team.id,
    visitor_team_id: game.visitor_team.id,
    home_score: game.home_team_score,
    visitor_score: game.visitor_team_score,
    periods_played: game.period ?? null,
  };
}

export function flattenTeam(team: BdlTeam): DataRow {
  return { team_id: team.id, abbreviation: team.abbreviation, city: team.city, name: team.name, full_name: team.full_name, conference: team.conference, division: team.division };
}

export function flattenPlayer(player: BdlPlayer, teamId: number | null, lastSeenDate: string | null): DataRow {
  return {
    player_id: player.id,
    first_name: player.first_name,
    last_name: player.last_name,
    position: player.position ?? "",
    jersey_number: player.jersey_number ?? null,
    team_id: teamId ?? player.team?.id ?? player.team_id ?? null,
    last_seen_date: lastSeenDate,
  };
}

export function flattenStat(statRow: BdlStats, gameLookup: Map<number, BdlGame>, period: number | null): DataRow {
  const game = gameLookup.get(statRow.game.id) ?? statRow.game;
  const homeTeamId = game.home_team?.id ?? (statRow.game as unknown as { home_team_id?: number }).home_team_id;
  const visitorTeamId = game.visitor_team?.id ?? (statRow.game as unknown as { visitor_team_id?: number }).visitor_team_id;
  const isHome = statRow.team.id === homeTeamId;
  const flattened: DataRow = {
    season: game.season,
    game_date: game.date,
    game_id: game.id,
    player_id: statRow.player.id,
    team_id: statRow.team.id,
    opponent_team_id: isHome ? (visitorTeamId ?? null) : (homeTeamId ?? null),
    is_home: isHome,
    minutes: Math.round(parseMinutes(statRow.min) * 100) / 100,
  };
  for (const fieldName of countingStatFields) flattened[fieldName] = statRow[fieldName] ?? (fieldName === "plus_minus" ? null : 0);
  for (const fieldName of percentStatFields) flattened[fieldName] = statRow[fieldName] ?? null;
  if (period !== null) flattened.period = period;
  return flattened;
}

export function flattenAdvanced(advancedRow: BdlAdvancedStatsV2, gameLookup: Map<number, BdlGame>, period: number): DataRow {
  const game = gameLookup.get(advancedRow.game.id) ?? advancedRow.game;
  const flattened: DataRow = {
    season: game.season,
    game_date: game.date,
    game_id: game.id,
    player_id: advancedRow.player.id,
    team_id: advancedRow.team.id,
    period: typeof advancedRow.period === "number" ? advancedRow.period : period,
  };
  for (const fieldName of advancedMetricFields) {
    const rawValue = advancedRow[fieldName];
    if (fieldName === "matchup_minutes") flattened[fieldName] = rawValue === null || rawValue === undefined ? null : parseMinutes(String(rawValue));
    else flattened[fieldName] = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : rawValue === null || rawValue === undefined ? null : Number(rawValue);
  }
  return flattened;
}

export function flattenLineup(lineupRow: BdlLineup, gameLookup: Map<number, BdlGame>): DataRow {
  const game = gameLookup.get(lineupRow.game_id);
  return {
    season: game?.season ?? null,
    game_date: game?.date ?? null,
    game_id: lineupRow.game_id,
    player_id: lineupRow.player.id,
    team_id: lineupRow.team?.id ?? lineupRow.player.team_id ?? null,
    starter: Boolean(lineupRow.starter),
    position: lineupRow.position ?? null,
  };
}
