"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAnalytics, useAnalyticsQuery, useSettings, type PolledData } from "./hooks";
import { fetchApi } from "./apiClient";
import type { SlateData } from "./slateData";
import { groupOddsByGame } from "@/lib/odds/consensus";
import { injuredScorers, teamRatings, type InjuredScorer, type LeagueRatings, type TeamRating } from "@/lib/analytics/aggregates/teamRatings";
import { teamRest, type RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import { evaluateGameLines, injuryReplacementShare, injuryWeight, marketConsensus, projectGame, type GameProjection, type InjuryImpact, type LineEdge } from "@/lib/analytics/gameModel";
import { applyLearning, learnParameters, type LearnedLine, type LearnedParameters, type LineSample } from "@/lib/analytics/lineLearning";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { addLinePicks, ensureLineStoreLoaded, linePicksSnapshot, readLineSamples, readThreeQuarterSamples, saveLineSamples, saveThreeQuarterSamples, subscribeLineStore, upsertLinePicks } from "./lineStore";
import { rateTeamForGame, selectThreeQuarterRecommendations, threeQuarterProfiles } from "@/lib/analytics/aggregates/threeQuarters";
import { calibrateRating, learnThreeQuarterCalibration, type ThreeQuarterCalibration, type ThreeQuarterSample } from "@/lib/analytics/threeQuarterLearning";
import { consensusLine, impliedTeamTotals } from "@/lib/odds/consensus";
import { readTracked } from "@/lib/tracking/trackerStore";
import { lineEdgeToTracked, modelLineToTracked, threeQuarterToTracked } from "@/lib/tracking/fromSources";
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
  projection: GameProjection; // the original model
  learned: LearnedLine; // after bias, market trust and outcome spread learned from past games
  edges: LineEdge[]; // learned edges: what the page shows and flags
  originalEdges: LineEdge[];
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

export function modelPicksFor(projection: GameProjection, edges: LineEdge[], projected: { margin: number; total: number }, rest: { homeRest: RestInfo | undefined; awayRest: RestInfo | undefined }, gameId: number, gameDate: string, leaguePace: number, backtest: boolean, version: "model" | "learned"): NewTracked[] {
  const backToBack = Boolean(rest.homeRest?.backToBack || rest.awayRest?.backToBack);
  return (["spread", "total", "moneyline"] as const).flatMap((market) => {
    const best = edges.filter((edge) => edge.market === market).sort((first, second) => second.evPercent - first.evPercent)[0]; // the model's side is the one it likes more at the best price
    if (!best) return [];
    const projectedValue = market === "total" ? projected.total : projected.margin;
    return [modelLineToTracked(best, projectedValue, modelTags(best, projection, leaguePace, { backToBack, backtest }), gameId, gameDate, version)];
  });
}

function learnedForOdds(projection: GameProjection, odds: BdlBettingOdd[], parameters: LearnedParameters): LearnedLine {
  const consensus = marketConsensus(odds);
  return applyLearning(projection, { margin: consensus.spreadHome === null ? null : -consensus.spreadHome, total: consensus.total }, parameters);
}

export function useLinePicks(): TrackedPick[] {
  return useSyncExternalStore(subscribeLineStore, linePicksSnapshot, linePicksSnapshot);
}

let historySyncStarted = false; // once per visit is enough: it only fills finished days

export function useThreeQuarterCalibration(): ThreeQuarterCalibration {
  const [samples, setSamples] = useState<ThreeQuarterSample[]>([]);
  useLearnedParameters(); // starts the history sync if it has not run this visit
  useEffect(() => {
    let cancelled = false;
    const refresh = () => readThreeQuarterSamples().then((stored) => !cancelled && setSamples(stored));
    void refresh();
    const unsubscribe = subscribeLineStore(() => void refresh()); // picks up new days once the sync saves them
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return learnThreeQuarterCalibration(samples);
}

export function useLearnedParameters(): { parameters: LearnedParameters; samples: LineSample[] } {
  const { handle } = useAnalytics();
  const settings = useSettings();
  const [samples, setSamples] = useState<LineSample[]>([]);
  useEffect(() => {
    let cancelled = false;
    readLineSamples().then((stored) => !cancelled && setSamples(stored));
    if (handle && !historySyncStarted) {
      historySyncStarted = true;
      syncLineHistory(handle.engine, appSettings.currentSeason, historyOptions(settings), () => undefined)
        .then(() => readLineSamples())
        .then((stored) => !cancelled && setSamples(stored))
        .catch(() => {
          historySyncStarted = false; // try again on the next visit
        });
    }
    return () => {
      cancelled = true;
    };
  }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps
  return { parameters: learnParameters(samples), samples };
}

export function useLineAnalyses(slate: PolledData<SlateData>): { analyses: GameAnalysis[]; ratings: LeagueRatings | null; ratingsLoading: boolean; gamesAhead: number; startedCount: number; parameters: LearnedParameters } {
  const settings = useSettings();
  const today = todayEastern();
  const games = (slate.data?.games ?? []).filter((game) => !isGameFinal(game) && !isGameLive(game)); // the model is pregame only
  const teamIds = games.flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const injuries = slate.data?.injuries ?? [];
  const injuredIds = injuries.map((injury) => injury.player.id);
  const ratings = useAnalyticsQuery((handle) => teamRatings(handle.engine, appSettings.currentSeason), `ratings:${today}`);
  const rest = useAnalyticsQuery(teamIds.length > 0 ? (handle) => teamRest(handle.engine, teamIds, today) : null, `lines-rest:${today}:${teamIds.join(",")}`);
  const scorers = useAnalyticsQuery(injuredIds.length > 0 ? (handle) => injuredScorers(handle.engine, injuredIds, appSettings.currentSeason) : null, `lines-injuries:${injuredIds.join(",")}`);
  const { parameters } = useLearnedParameters();
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const analyses: GameAnalysis[] = [];
  if (ratings.result) {
    for (const game of games) {
      const home = ratings.result.teams.get(game.home_team.id);
      const away = ratings.result.teams.get(game.visitor_team.id);
      if (!home || !away) continue;
      const homeRest = rest.result?.get(game.home_team.id);
      const awayRest = rest.result?.get(game.visitor_team.id);
      const gameOdds = oddsByGame.get(game.id) ?? [];
      const projection = projectGame(home, away, ratings.result, { homeRest, awayRest, homeInjuries: injuriesFor(game.home_team.id, injuries, scorers.result), awayInjuries: injuriesFor(game.visitor_team.id, injuries, scorers.result) });
      const learned = learnedForOdds(projection, gameOdds, parameters);
      const originalEdges = evaluateGameLines(projection, gameOdds, game.home_team.abbreviation, game.visitor_team.abbreviation, settings.evThresholdPercent);
      const edges = evaluateGameLines(learned, gameOdds, game.home_team.abbreviation, game.visitor_team.abbreviation, settings.evThresholdPercent, { margin: learned.marginDeviation, total: learned.totalDeviation });
      analyses.push({ game, projection, learned, edges, originalEdges, home, away, homeRest, awayRest, bestEv: Math.max(-Infinity, ...edges.filter((edge) => edge.flagged).map((edge) => edge.evPercent)) });
    }
  }
  analyses.sort((first, second) => second.bestEv - first.bestEv || (first.game.datetime ?? "").localeCompare(second.game.datetime ?? ""));
  const ready = Boolean(ratings.result) && (teamIds.length === 0 || Boolean(rest.result)) && (injuredIds.length === 0 || Boolean(scorers.result)); // wait for every input so a snapshot is never half-built
  const snapshotKey = ready ? `${parameters.sampleCount}|` + analyses.map((analysis) => `${analysis.game.id}:${analysis.edges.map((edge) => `${edge.selection}${edge.line}${edge.americanOdds}`).join("")}:${analysis.projection.margin.toFixed(1)}`).join("|") : "";
  useEffect(() => {
    if (!snapshotKey || !ratings.result) return;
    const leaguePace = ratings.result.pace;
    trackPicks(analyses.flatMap((analysis) => analysis.edges.filter((edge) => edge.flagged).map((edge) => lineEdgeToTracked(edge, analysis.game.id, analysis.game.date)))); // flagged edges keep their first price
    void upsertLinePicks(
      analyses.flatMap((analysis) => [
        ...modelPicksFor(analysis.projection, analysis.originalEdges, analysis.projection, analysis, analysis.game.id, analysis.game.date, leaguePace, false, "model"),
        ...modelPicksFor(analysis.projection, analysis.edges, analysis.learned, analysis, analysis.game.id, analysis.game.date, leaguePace, false, "learned"),
      ]),
    ); // both versions keep the last line seen before tip-off
  }, [snapshotKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { analyses, ratings: ratings.result, ratingsLoading: ratings.loading, gamesAhead: games.length, startedCount: (slate.data?.games ?? []).length - games.length, parameters };
}

export interface BacktestProgress {
  totalDates: number;
  completedDates: number;
  picks: number;
}

export interface HistoryOptions {
  evThresholdPercent: number;
  threeQuarterMinimumPercent: number;
  threeQuarterMaxPicks: number;
}

export function historyOptions(settings: { evThresholdPercent: number; threeQuarterMinimumPercent: number; threeQuarterMaxPicks: number }): HistoryOptions {
  return { evThresholdPercent: settings.evThresholdPercent, threeQuarterMinimumPercent: settings.threeQuarterMinimumPercent, threeQuarterMaxPicks: settings.threeQuarterMaxPicks };
}

async function replayThreeQuarters(engine: AnalyticsEngine, season: number, gameDate: string, dayRows: Array<{ game_id: number; home_team_id: number; visitor_team_id: number }>, oddsByGame: Map<number, BdlBettingOdd[]>, threeQuarterSamples: ThreeQuarterSample[], options: HistoryOptions): Promise<ThreeQuarterSample[]> {
  const teamIds = dayRows.flatMap((gameRow) => [Number(gameRow.home_team_id), Number(gameRow.visitor_team_id)]);
  const profiles = await threeQuarterProfiles(engine, teamIds, [season, season - 1], gameDate); // only games before that day
  const actualRows = await engine.query<{ game_id: number; team_id: number; points: number }>(`SELECT game_id, team_id, points FROM team_scope_lines WHERE scope = 'T3' AND game_id IN (${dayRows.map((gameRow) => sqlNumber(gameRow.game_id)).join(", ")})`);
  const actualByKey = new Map(actualRows.map((actualRow) => [`${actualRow.game_id}-${actualRow.team_id}`, Number(actualRow.points)]));
  const calibration = learnThreeQuarterCalibration(threeQuarterSamples, gameDate); // walk forward: earlier days only
  const daySamples: ThreeQuarterSample[] = [];
  const candidates: Array<{ gameId: number; teamId: number; opponentId: number; chance: number; projection: number }> = [];
  for (const gameRow of dayRows) {
    const gameId = Number(gameRow.game_id);
    const consensus = consensusLine(oddsByGame.get(gameId) ?? []);
    const implied = impliedTeamTotals(consensus.spreadHome, consensus.total);
    for (const isHome of [true, false]) {
      const teamId = Number(isHome ? gameRow.home_team_id : gameRow.visitor_team_id);
      const opponentId = Number(isHome ? gameRow.visitor_team_id : gameRow.home_team_id);
      const rated = rateTeamForGame(profiles, teamId, opponentId, isHome ? implied.home : implied.away, season);
      const actual = actualByKey.get(`${gameId}-${teamId}`);
      if (rated.rating === null || rated.projection.probability === null || rated.projection.projection === null || actual === undefined) continue;
      daySamples.push({ sampleKey: `${gameId}-${teamId}`, gameId, teamId, gameDate, season, rating: rated.rating, lineChance: rated.projection.probability, hit: actual >= appSettings.hundredThroughThreeTarget });
      candidates.push({ gameId, teamId, opponentId, chance: calibrateRating(rated.rating, calibration), projection: rated.projection.projection });
    }
  }
  const alreadyRecorded = readTracked().some((pick) => pick.source === "100-in-3" && pick.gameDate === gameDate); // a day seen live keeps its live picks
  if (!alreadyRecorded) {
    const chosen = selectThreeQuarterRecommendations(candidates.map((candidate) => ({ ...candidate, rating: candidate.chance })), options.threeQuarterMinimumPercent / 100, options.threeQuarterMaxPicks);
    trackPicks([...chosen].map((candidate) => ({ ...threeQuarterToTracked(candidate.gameId, gameDate, candidate.teamId, teamById(candidate.teamId)?.abbreviation ?? "", teamById(candidate.opponentId)?.abbreviation ?? "", candidate.chance, candidate.projection), tags: ["Backtest"] })));
  }
  return daySamples;
}

export async function syncLineHistory(engine: AnalyticsEngine, season: number, options: HistoryOptions, onProgress: (progress: BacktestProgress) => void): Promise<number> {
  const { evThresholdPercent } = options;
  await ensureLineStoreLoaded();
  const today = todayEastern();
  const gameRows = await engine.query<{ game_id: number; game_date: string; home_team_id: number; visitor_team_id: number; home_score: number | null; visitor_score: number | null }>(
    `SELECT game_id, game_date, home_team_id, visitor_team_id, home_score, visitor_score FROM games WHERE season = ${sqlNumber(season)} AND game_date < ${sqlString(today)} AND postseason IS NOT TRUE ORDER BY game_date, game_id`,
  );
  const samples = await readLineSamples();
  const sampledIds = new Set(samples.map((sample) => sample.gameId));
  const pickIds = new Set(linePicksSnapshot().map((pick) => pick.trackId));
  const threeQuarterSamples = await readThreeQuarterSamples();
  const threeQuarterGames = new Set(threeQuarterSamples.map((sample) => sample.gameId));
  const isDone = (gameId: number) => sampledIds.has(gameId) && threeQuarterGames.has(gameId) && ["model", "learned"].every((version) => ["spread", "total", "moneyline"].every((market) => pickIds.has(`${version}-${gameId}-${market}`)));
  const pendingDates = [...new Set(gameRows.filter((gameRow) => !isDone(Number(gameRow.game_id))).map((gameRow) => String(gameRow.game_date)))];
  let added = 0;
  onProgress({ totalDates: pendingDates.length, completedDates: 0, picks: 0 });
  for (const [dateIndex, gameDate] of pendingDates.entries()) {
    const dayRows = gameRows.filter((gameRow) => String(gameRow.game_date) === gameDate);
    const ratings = await teamRatings(engine, season, gameDate); // only games before that day
    const rest = await teamRest(engine, dayRows.flatMap((gameRow) => [Number(gameRow.home_team_id), Number(gameRow.visitor_team_id)]), gameDate);
    let odds: BdlBettingOdd[] = [];
    try {
      odds = (await fetchApi<{ data?: BdlBettingOdd[] }>(`/api/odds/opening?date=${gameDate}`)).data ?? []; // opening lines: the honest pregame price for a past day
    } catch {
      odds = [];
    }
    const oddsByGame = groupOddsByGame(odds);
    const parameters = learnParameters(samples, gameDate); // walk forward: learn only from earlier days
    const daySamples: LineSample[] = [];
    const dayPicks: NewTracked[] = [];
    for (const gameRow of dayRows) {
      const gameId = Number(gameRow.game_id);
      const homeId = Number(gameRow.home_team_id);
      const awayId = Number(gameRow.visitor_team_id);
      const home = ratings.teams.get(homeId);
      const away = ratings.teams.get(awayId);
      if (!home || !away || gameRow.home_score === null || gameRow.visitor_score === null) continue;
      const homeRest = rest.get(homeId);
      const awayRest = rest.get(awayId);
      const projection = projectGame(home, away, ratings, { homeRest, awayRest, homeInjuries: [], awayInjuries: [] }); // past injury reports are not stored
      const gameOdds = oddsByGame.get(gameId) ?? [];
      const consensus = marketConsensus(gameOdds);
      daySamples.push({
        gameId,
        gameDate,
        season,
        modelMargin: projection.margin,
        modelTotal: projection.total,
        marketMargin: consensus.spreadHome === null ? null : -consensus.spreadHome,
        marketTotal: consensus.total,
        actualMargin: Number(gameRow.home_score) - Number(gameRow.visitor_score),
        actualTotal: Number(gameRow.home_score) + Number(gameRow.visitor_score),
      });
      if (gameOdds.length === 0) continue;
      const homeAbbreviation = teamById(homeId)?.abbreviation ?? "HOME";
      const awayAbbreviation = teamById(awayId)?.abbreviation ?? "AWAY";
      const learned = applyLearning(projection, { margin: consensus.spreadHome === null ? null : -consensus.spreadHome, total: consensus.total }, parameters);
      const originalEdges = evaluateGameLines(projection, gameOdds, homeAbbreviation, awayAbbreviation, evThresholdPercent);
      const learnedEdges = evaluateGameLines(learned, gameOdds, homeAbbreviation, awayAbbreviation, evThresholdPercent, { margin: learned.marginDeviation, total: learned.totalDeviation });
      dayPicks.push(...modelPicksFor(projection, originalEdges, projection, { homeRest, awayRest }, gameId, gameDate, ratings.pace, true, "model"));
      dayPicks.push(...modelPicksFor(projection, learnedEdges, learned, { homeRest, awayRest }, gameId, gameDate, ratings.pace, true, "learned"));
    }
    const freshThreeQuarters = (await replayThreeQuarters(engine, season, gameDate, dayRows, oddsByGame, threeQuarterSamples, options)).filter((sample) => !threeQuarterGames.has(sample.gameId));
    threeQuarterSamples.push(...freshThreeQuarters); // after the whole day, like the line history
    freshThreeQuarters.forEach((sample) => threeQuarterGames.add(sample.gameId));
    await saveThreeQuarterSamples(freshThreeQuarters);
    const freshSamples = daySamples.filter((sample) => !sampledIds.has(sample.gameId));
    samples.push(...freshSamples); // added after the whole day, so same-day games never learn from each other
    freshSamples.forEach((sample) => sampledIds.add(sample.gameId));
    await saveLineSamples(freshSamples);
    added += await addLinePicks(dayPicks); // picks saved live before tip-off are never replaced
    onProgress({ totalDates: pendingDates.length, completedDates: dateIndex + 1, picks: added });
  }
  return added;
}
