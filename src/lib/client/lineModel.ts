"use client";

import { useEffect } from "react";
import { useAnalyticsQuery, useSettings, type PolledData } from "./hooks";
import { fetchApi } from "./apiClient";
import type { SlateData } from "./slateData";
import { groupOddsByGame } from "@/lib/odds/consensus";
import { injuredScorers, teamRatings, type InjuredScorer, type LeagueRatings, type TeamRating } from "@/lib/analytics/aggregates/teamRatings";
import { teamRest, type RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import { evaluateGameLines, injuryReplacementShare, injuryWeight, projectGame, type GameProjection, type InjuryImpact, type LineEdge } from "@/lib/analytics/gameModel";
import { trackPicks, upsertPicks } from "@/lib/tracking/trackerStore";
import { lineEdgeToTracked, modelLineToTracked } from "@/lib/tracking/fromSources";
import type { TrackedPick } from "@/lib/tracking/tracker";
import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlString } from "@/lib/analytics/engine";
import { isGameFinal, isGameLive } from "@/lib/data/flatten";
import { todayEastern } from "@/lib/dates";
import { appSettings } from "@/config/appSettings";
import { teamById } from "@/lib/nba/teams";
import type { BdlBettingOdd, BdlGame, BdlPlayerInjury } from "@/lib/bdl/types";

const injuryMinimumMinutes = 15; // bench players barely move a team total

export interface GameAnalysis {
  game: BdlGame;
  projection: GameProjection;
  edges: LineEdge[];
  home: TeamRating;
  away: TeamRating;
  homeRest: RestInfo | undefined;
  awayRest: RestInfo | undefined;
  bestEv: number;
}

type NewTracked = Omit<TrackedPick, "createdAt" | "result">;

export function injuriesFor(teamId: number, injuries: BdlPlayerInjury[], scorers: Map<number, InjuredScorer> | null): InjuryImpact[] {
  if (!scorers) return [];
  return injuries.flatMap((injury) => {
    const scorer = scorers.get(injury.player.id);
    const weight = injuryWeight(injury.status);
    if (!scorer || scorer.teamId !== teamId || weight === 0 || !scorer.playedRecently || scorer.minutesPerGame < injuryMinimumMinutes) return []; // long absences are already in the team numbers
    return [{ playerName: `${injury.player.first_name.charAt(0)}. ${injury.player.last_name}`, status: injury.status, pointsLost: scorer.pointsPerGame * weight * (1 - injuryReplacementShare) }];
  });
}

function gapBucket(edge: LineEdge, projection: GameProjection): string | null {
  if (edge.marketValue === null) return null;
  if (edge.market === "spread") {
    const gap = Math.abs(-projection.margin - edge.marketValue);
    return gap < 1.5 ? "Model within 1.5 pts" : gap < 3 ? "Model 1.5-3 pts off" : "Model 3+ pts off";
  }
  if (edge.market === "total") {
    const gap = Math.abs(projection.total - edge.marketValue);
    return gap < 3 ? "Model within 3 pts" : gap < 6 ? "Model 3-6 pts off" : "Model 6+ pts off";
  }
  const gap = Math.abs(projection.homeWinProbability - edge.marketValue);
  return gap < 0.05 ? "Model within 5%" : gap < 0.1 ? "Model 5-10% off" : "Model 10%+ off";
}

export function modelTags(edge: LineEdge, projection: GameProjection, leaguePace: number, context: { backToBack: boolean; backtest: boolean }): string[] {
  const tags: string[] = [];
  if (edge.market === "total") tags.push(edge.selection === "total_over" ? "Over" : "Under");
  else tags.push(edge.selection.endsWith("home") ? "Home side" : "Away side");
  if (edge.market === "spread") tags.push((edge.line ?? 0) < 0 ? "Favorite" : "Underdog");
  if (edge.market === "moneyline") tags.push(edge.americanOdds < 0 ? "Favorite" : "Underdog");
  if (edge.market === "spread" && edge.marketValue !== null && Math.abs(edge.marketValue) >= 8) tags.push("Big spread (8+)");
  if (edge.market === "total") {
    if (projection.pace >= leaguePace + 2) tags.push("Fast projected pace");
    else if (projection.pace <= leaguePace - 2) tags.push("Slow projected pace");
  }
  const gap = gapBucket(edge, projection);
  if (gap) tags.push(gap);
  tags.push(edge.flagged ? "Flagged edge" : "Not flagged");
  if (context.backToBack) tags.push("Back-to-back game");
  if (projection.factors.some((factor) => factor.label.includes("missing"))) tags.push("Injury-adjusted");
  if (context.backtest) tags.push("Backtest");
  return tags;
}

export function modelPicksFor(analysis: Pick<GameAnalysis, "projection" | "edges" | "homeRest" | "awayRest">, gameId: number, gameDate: string, leaguePace: number, backtest: boolean): NewTracked[] {
  const backToBack = Boolean(analysis.homeRest?.backToBack || analysis.awayRest?.backToBack);
  return (["spread", "total", "moneyline"] as const).flatMap((market) => {
    const best = analysis.edges.filter((edge) => edge.market === market).sort((first, second) => second.evPercent - first.evPercent)[0]; // the model's side is the one it likes more at the best price
    if (!best) return [];
    const projectedValue = market === "total" ? analysis.projection.total : analysis.projection.margin;
    return [modelLineToTracked(best, projectedValue, modelTags(best, analysis.projection, leaguePace, { backToBack, backtest }), gameId, gameDate)];
  });
}

export function useLineAnalyses(slate: PolledData<SlateData>): { analyses: GameAnalysis[]; ratings: LeagueRatings | null; ratingsLoading: boolean; gamesAhead: number; startedCount: number } {
  const settings = useSettings();
  const today = todayEastern();
  const games = (slate.data?.games ?? []).filter((game) => !isGameFinal(game) && !isGameLive(game)); // the model is pregame only
  const teamIds = games.flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const injuries = slate.data?.injuries ?? [];
  const injuredIds = injuries.map((injury) => injury.player.id);
  const ratings = useAnalyticsQuery((handle) => teamRatings(handle.engine, appSettings.currentSeason), `ratings:${today}`);
  const rest = useAnalyticsQuery(teamIds.length > 0 ? (handle) => teamRest(handle.engine, teamIds, today) : null, `lines-rest:${today}:${teamIds.join(",")}`);
  const scorers = useAnalyticsQuery(injuredIds.length > 0 ? (handle) => injuredScorers(handle.engine, injuredIds, appSettings.currentSeason) : null, `lines-injuries:${injuredIds.join(",")}`);
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const analyses: GameAnalysis[] = [];
  if (ratings.result) {
    for (const game of games) {
      const home = ratings.result.teams.get(game.home_team.id);
      const away = ratings.result.teams.get(game.visitor_team.id);
      if (!home || !away) continue;
      const homeRest = rest.result?.get(game.home_team.id);
      const awayRest = rest.result?.get(game.visitor_team.id);
      const projection = projectGame(home, away, ratings.result, { homeRest, awayRest, homeInjuries: injuriesFor(game.home_team.id, injuries, scorers.result), awayInjuries: injuriesFor(game.visitor_team.id, injuries, scorers.result) });
      const edges = evaluateGameLines(projection, oddsByGame.get(game.id) ?? [], game.home_team.abbreviation, game.visitor_team.abbreviation, settings.evThresholdPercent);
      analyses.push({ game, projection, edges, home, away, homeRest, awayRest, bestEv: Math.max(-Infinity, ...edges.filter((edge) => edge.flagged).map((edge) => edge.evPercent)) });
    }
  }
  analyses.sort((first, second) => second.bestEv - first.bestEv || (first.game.datetime ?? "").localeCompare(second.game.datetime ?? ""));
  const ready = Boolean(ratings.result) && (teamIds.length === 0 || Boolean(rest.result)) && (injuredIds.length === 0 || Boolean(scorers.result)); // wait for every input so a snapshot is never half-built
  const snapshotKey = ready ? analyses.map((analysis) => `${analysis.game.id}:${analysis.edges.map((edge) => `${edge.selection}${edge.line}${edge.americanOdds}`).join("")}:${analysis.projection.margin.toFixed(1)}`).join("|") : "";
  useEffect(() => {
    if (!snapshotKey || !ratings.result) return;
    const leaguePace = ratings.result.pace;
    trackPicks(analyses.flatMap((analysis) => analysis.edges.filter((edge) => edge.flagged).map((edge) => lineEdgeToTracked(edge, analysis.game.id, analysis.game.date)))); // flagged edges keep their first price
    upsertPicks(analyses.flatMap((analysis) => modelPicksFor(analysis, analysis.game.id, analysis.game.date, leaguePace, false))); // the model record keeps the last line before tip-off
  }, [snapshotKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { analyses, ratings: ratings.result, ratingsLoading: ratings.loading, gamesAhead: games.length, startedCount: (slate.data?.games ?? []).length - games.length };
}

export interface BacktestProgress {
  totalDates: number;
  completedDates: number;
  picks: number;
}

export async function backtestSeason(engine: AnalyticsEngine, season: number, evThresholdPercent: number, knownTrackIds: Set<string>, onProgress: (progress: BacktestProgress) => void): Promise<NewTracked[]> {
  const today = todayEastern();
  const gameRows = await engine.query<{ game_id: number; game_date: string; home_team_id: number; visitor_team_id: number }>(
    `SELECT game_id, game_date, home_team_id, visitor_team_id FROM games WHERE season = ${sqlNumber(season)} AND game_date < ${sqlString(today)} AND postseason IS NOT TRUE ORDER BY game_date, game_id`,
  );
  const pendingRows = gameRows.filter((gameRow) => !["spread", "total", "moneyline"].every((market) => knownTrackIds.has(`model-${gameRow.game_id}-${market}`)));
  const dates = [...new Set(pendingRows.map((gameRow) => String(gameRow.game_date)))];
  const picks: NewTracked[] = [];
  onProgress({ totalDates: dates.length, completedDates: 0, picks: 0 });
  for (const [dateIndex, gameDate] of dates.entries()) {
    const dayRows = pendingRows.filter((gameRow) => String(gameRow.game_date) === gameDate);
    const ratings = await teamRatings(engine, season, gameDate); // only games before that day
    const rest = await teamRest(engine, dayRows.flatMap((gameRow) => [Number(gameRow.home_team_id), Number(gameRow.visitor_team_id)]), gameDate);
    let odds: BdlBettingOdd[] = [];
    try {
      odds = (await fetchApi<{ data?: BdlBettingOdd[] }>(`/api/odds/opening?date=${gameDate}`)).data ?? []; // opening lines: the honest pregame price for a past day
    } catch {
      odds = [];
    }
    const oddsByGame = groupOddsByGame(odds);
    for (const gameRow of dayRows) {
      const homeId = Number(gameRow.home_team_id);
      const awayId = Number(gameRow.visitor_team_id);
      const home = ratings.teams.get(homeId);
      const away = ratings.teams.get(awayId);
      const gameOdds = oddsByGame.get(Number(gameRow.game_id)) ?? [];
      if (!home || !away || gameOdds.length === 0) continue;
      const homeRest = rest.get(homeId);
      const awayRest = rest.get(awayId);
      const projection = projectGame(home, away, ratings, { homeRest, awayRest, homeInjuries: [], awayInjuries: [] }); // past injury reports are not stored
      const edges = evaluateGameLines(projection, gameOdds, teamById(homeId)?.abbreviation ?? "HOME", teamById(awayId)?.abbreviation ?? "AWAY", evThresholdPercent);
      picks.push(...modelPicksFor({ projection, edges, homeRest, awayRest }, Number(gameRow.game_id), gameDate, ratings.pace, true).filter((pick) => !knownTrackIds.has(pick.trackId)));
    }
    onProgress({ totalDates: dates.length, completedDates: dateIndex + 1, picks: picks.length });
  }
  return picks;
}
