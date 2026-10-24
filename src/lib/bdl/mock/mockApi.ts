import type { QueryParams, QueryValue } from "@/lib/bdl/bdlClient";
import type { BdlGame } from "@/lib/bdl/types";
import { teamReferences, bdlTeam } from "@/lib/nba/teams";
import { addDays } from "@/lib/dates";
import {
  allMockPlayers,
  mockAdvancedStats,
  mockBoxScore,
  mockGameById,
  mockGameOdds,
  mockGamesForDate,
  mockGamesInRange,
  mockInjuryRows,
  mockLineups,
  mockPlayerById,
  mockPlayerProps,
  mockPlays,
  mockSeasonRanges,
  mockStatsForGame,
  mockToday,
} from "./mockWorld";

function asList(paramValue: QueryValue): string[] {
  if (paramValue === undefined || paramValue === null || paramValue === "") return [];
  return Array.isArray(paramValue) ? paramValue.map(String) : [String(paramValue)];
}

function numberList(params: QueryParams, ...paramNames: string[]): number[] {
  return paramNames.flatMap((paramName) => asList(params[paramName])).map(Number).filter(Number.isFinite);
}

function stringList(params: QueryParams, ...paramNames: string[]): string[] {
  return paramNames.flatMap((paramName) => asList(params[paramName]));
}

function paginate<ItemType>(items: ItemType[], params: QueryParams) {
  const perPage = Math.min(100, Number(params.per_page ?? 25) || 25);
  const offset = Number(params.cursor ?? 0) || 0;
  const pageItems = items.slice(offset, offset + perPage);
  const nextOffset = offset + perPage;
  return { data: pageItems, meta: { per_page: perPage, next_cursor: nextOffset < items.length ? nextOffset : null } };
}

function gamesMatching(params: QueryParams): BdlGame[] {
  const dates = stringList(params, "dates[]", "dates");
  const gameIds = numberList(params, "game_ids[]", "game_ids");
  const seasons = numberList(params, "seasons[]");
  const teamIds = numberList(params, "team_ids[]");
  let games: BdlGame[];
  if (gameIds.length > 0) games = gameIds.map((gameId) => mockGameById(gameId)).filter((game): game is BdlGame => Boolean(game));
  else if (dates.length > 0) games = dates.flatMap((isoDate) => mockGamesForDate(isoDate));
  else {
    const seasonList = seasons.length > 0 ? seasons : Object.keys(mockSeasonRanges).map(Number);
    const startDate = String(params.start_date ?? "");
    const endDate = String(params.end_date ?? "");
    games = seasonList.flatMap((season) => {
      const range = mockSeasonRanges[season];
      if (!range) return [];
      const rangeStart = startDate && startDate > range[0] ? startDate : range[0];
      const rangeEnd = endDate && endDate < range[1] ? endDate : range[1];
      return mockGamesInRange(rangeStart, rangeEnd);
    });
  }
  if (params.start_date) games = games.filter((game) => game.date >= String(params.start_date));
  if (params.end_date) games = games.filter((game) => game.date <= String(params.end_date));
  if (seasons.length > 0) games = games.filter((game) => seasons.includes(game.season));
  if (teamIds.length > 0) games = games.filter((game) => teamIds.includes(game.home_team.id) || teamIds.includes(game.visitor_team.id));
  return games;
}

function playersMatching(params: QueryParams) {
  const teamIds = numberList(params, "team_ids[]");
  const playerIds = numberList(params, "player_ids[]");
  const searchText = String(params.search ?? "").toLowerCase();
  return allMockPlayers().filter((player) => {
    if (teamIds.length > 0 && !teamIds.includes(player.team?.id ?? -1)) return false;
    if (playerIds.length > 0 && !playerIds.includes(player.id)) return false;
    if (searchText && !`${player.first_name} ${player.last_name}`.toLowerCase().includes(searchText)) return false;
    if (params.first_name && player.first_name.toLowerCase() !== String(params.first_name).toLowerCase()) return false;
    if (params.last_name && player.last_name.toLowerCase() !== String(params.last_name).toLowerCase()) return false;
    return true;
  });
}

export function handleMockRequest(path: string, params: QueryParams): unknown {
  const singleMatch = path.match(/^\/nba\/v1\/(teams|players|games)\/(\d+)$/);
  if (singleMatch) {
    const entityId = Number(singleMatch[2]);
    if (singleMatch[1] === "teams") return { data: bdlTeam(entityId) };
    if (singleMatch[1] === "players") return { data: mockPlayerById(entityId) };
    return { data: mockGameById(entityId) };
  }
  switch (path) {
    case "/nba/v1/teams":
      return { data: teamReferences.map((team) => bdlTeam(team.id)) };
    case "/nba/v1/players":
    case "/nba/v1/players/active":
      return paginate(playersMatching(params), params);
    case "/nba/v1/games":
      return paginate(gamesMatching(params), params);
    case "/nba/v1/stats": {
      const periodFilter = Number(params.period ?? 0) || 0;
      const playerIds = numberList(params, "player_ids[]");
      const games = gamesMatching(params).filter((game) => periodFilter === 0 || game.status_state === "final"); // period filter only works for completed games
      let statRows = games.flatMap((game) => mockStatsForGame(game, periodFilter));
      if (playerIds.length > 0) statRows = statRows.filter((statRow) => playerIds.includes(statRow.player.id));
      return paginate(statRows, params);
    }
    case "/nba/v2/stats/advanced": {
      const periodFilter = Number(params.period ?? 0) || 0;
      const games = gamesMatching(params).filter((game) => game.status_state === "final");
      return paginate(games.flatMap((game) => mockAdvancedStats(game, periodFilter)), params);
    }
    case "/nba/v1/box_scores/live":
      return { data: mockGamesForDate(mockToday()).filter((game) => game.status_state === "in_progress").map(mockBoxScore) };
    case "/nba/v1/box_scores":
      return { data: mockGamesForDate(String(params.date)).filter((game) => game.status_state !== "scheduled").map(mockBoxScore) };
    case "/nba/v1/lineups": {
      const games = numberList(params, "game_ids").map((gameId) => mockGameById(gameId)).filter((game): game is BdlGame => Boolean(game) && game?.status_state !== "scheduled");
      return paginate(games.flatMap(mockLineups), params);
    }
    case "/nba/v1/plays": {
      const game = mockGameById(Number(params.game_id));
      return { data: game ? mockPlays(game) : [] };
    }
    case "/nba/v1/player_injuries":
      return paginate(mockInjuryRows(), params);
    case "/nba/v2/odds":
      return paginate(gamesMatching(params).flatMap((game) => mockGameOdds(game, false)), params);
    case "/nba/v2/odds/opening":
      return paginate(gamesMatching(params).filter((game) => game.date >= addDays(mockToday(), -400)).flatMap((game) => mockGameOdds(game, true)), params);
    case "/nba/v2/odds/player_props":
    case "/nba/v2/odds/player_props/opening": {
      const game = mockGameById(Number(params.game_id));
      const opening = path.endsWith("/opening");
      const props = game ? mockPlayerProps(game, opening, params.player_id ? Number(params.player_id) : undefined, params.prop_type ? String(params.prop_type) : undefined) : [];
      return { data: props, meta: { per_page: props.length } };
    }
    default:
      throw new Error(`mock mode has no fixture for ${path}`);
  }
}
