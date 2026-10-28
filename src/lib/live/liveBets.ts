import type { LivePropRow } from "@/lib/analytics/liveSuggestions";
import type { GameClock } from "@/lib/analytics/liveProjection";
import type { BdlBoxScore, BdlBoxScorePlayer } from "@/lib/bdl/types";
import { propMapping } from "@/lib/analytics/propTypes";
import { boxMetricValue } from "@/lib/analytics/halftimeSuggestions";
import { expectedValuePercent } from "@/lib/math/odds";
import { parseMinutes } from "@/lib/dates";

export const liveBetMaximumEvPercent = 25; // live prop prices move fast; bigger claimed edges are almost always a stale line
export const liveBetMinimumEvPercent = 3;
export const bestBetRule = { minimumEvPercent: 8, minimumModelProbability: 0.55 }; // the short list; every other flag is still recorded so the record shows where the edge really is
export const bestBetTag = "Best bet";

export type LiveBetStatus = "win" | "loss" | "push" | "void";

export type Checkpoint = "end-q1" | "halftime" | "end-q3";

export const checkpointLabels: Record<Checkpoint, string> = { "end-q1": "End of Q1", halftime: "Halftime", "end-q3": "End of Q3" };

export const picksPerCheckpoint = 5; // the best plays on the board at each break, one per player

export interface LiveBetPick {
  pickId: string; // one per game, player and market
  gameDate: string;
  gameId: number;
  matchup: string;
  playerId: number;
  playerName: string;
  teamAbbreviation: string;
  propType: string;
  label: string;
  side: "over" | "under";
  line: number;
  americanOdds: number;
  vendor: string;
  modelProbability: number;
  evPercent: number;
  foundAt: string;
  clockLabel: string; // Q2 4:31, Halftime
  period: number;
  scoreMargin: number; // the player's team minus the opponent when found
  valueAtPick: number;
  projection: number;
  latestValue: number;
  tags: string[];
  checkpoint?: Checkpoint; // missing on picks from before checkpoints
  result: { status: LiveBetStatus; actual: number | null; gradedAt: string } | null;
}

export interface LiveNight {
  date: string;
  updatedAt: string;
  state: "waiting" | "running" | "done";
  games: Array<{ gameId: number; matchup: string; status: string; homeScore: number; visitorScore: number }>;
  picks: LiveBetPick[];
  calls: number; // BALLDONTLIE requests this run
  note: string | null;
  checkpointsTaken?: Record<string, Checkpoint[]>; // by game id
}

export function clockLabelFor(clock: GameClock): string {
  if (clock.isFinished) return "Final";
  if (clock.isHalftime) return "Halftime";
  const minutes = Math.floor(clock.secondsLeftInPeriod / 60);
  const seconds = String(Math.floor(clock.secondsLeftInPeriod % 60)).padStart(2, "0");
  return `${clock.period <= 4 ? `Q${clock.period}` : `OT${clock.period - 4}`} ${minutes}:${seconds}`;
}

export function checkpointFor(clock: GameClock): Checkpoint | null {
  if (clock.isFinished) return null;
  if (clock.isHalftime) return "halftime";
  const atBreak = clock.secondsLeftInPeriod <= 5; // the quarter just ended
  const justStarted = clock.secondsLeftInPeriod >= 660; // first minute of the next quarter, in case the break was missed between checks
  if ((clock.period === 1 && atBreak) || (clock.period === 2 && justStarted)) return "end-q1";
  if ((clock.period === 2 && atBreak) || (clock.period === 3 && justStarted)) return "halftime";
  if ((clock.period === 3 && atBreak) || (clock.period === 4 && justStarted)) return "end-q3";
  return null;
}

export function selectCheckpointPicks(candidates: LiveBetPick[], checkpoint: Checkpoint, takenPickIds: Set<string>, limit = picksPerCheckpoint): LiveBetPick[] {
  const bestByPlayer = new Map<number, LiveBetPick>();
  for (const candidate of candidates) {
    if (takenPickIds.has(candidate.pickId)) continue; // a player and market is only picked once per game
    const current = bestByPlayer.get(candidate.playerId);
    if (!current || candidate.evPercent > current.evPercent) bestByPlayer.set(candidate.playerId, candidate);
  }
  return [...bestByPlayer.values()]
    .sort((first, second) => second.evPercent - first.evPercent)
    .slice(0, limit)
    .map((pick) => ({ ...pick, checkpoint, clockLabel: checkpointLabels[checkpoint], tags: [...pick.tags.filter((tag) => !tag.startsWith("Found in") && tag !== "Halftime"), checkpointLabels[checkpoint]] }));
}

export function pickTags(row: LivePropRow, clock: GameClock, side: "over" | "under", scoreMargin: number): string[] {
  const tags = [side === "over" ? "Over" : "Under", row.label];
  tags.push(clock.isHalftime ? "Halftime" : clock.period <= 4 ? `Found in Q${clock.period}` : "Found in OT");
  if (Math.abs(scoreMargin) >= 15) tags.push("Blowout risk");
  if (row.personalFouls >= 3) tags.push("Foul trouble");
  if (row.shooting && Math.abs(row.shooting.luck) >= 3) tags.push(row.shooting.luck < 0 ? "Cold shooter" : "Hot shooter");
  tags.push(row.currentValue / Math.max(row.lineValue, 0.5) >= 0.6 ? "Already 60%+ of line" : "Under 60% of line");
  return tags;
}

export function pickFromRow(row: LivePropRow, boxScore: BdlBoxScore, gameId: number, gameDate: string, clock: GameClock, nowIso: string): LiveBetPick | null {
  const side = row.evaluation.bestSide;
  if (!row.flagged || !side || row.inactiveNote) return null;
  const americanOdds = side === "over" ? row.bestOverOdds : row.bestUnderOdds;
  const vendor = side === "over" ? row.bestOverVendor : row.bestUnderVendor;
  const modelProbability = side === "over" ? row.evaluation.overProbability : row.evaluation.underProbability;
  if (americanOdds === null || vendor === null) return null;
  const evPercent = expectedValuePercent(modelProbability, americanOdds);
  if (evPercent < liveBetMinimumEvPercent || evPercent >= liveBetMaximumEvPercent) return null;
  const isHome = boxScore.home_team.team.id === row.teamId;
  const scoreMargin = isHome ? boxScore.home_team_score - boxScore.visitor_team_score : boxScore.visitor_team_score - boxScore.home_team_score;
  return {
    pickId: `${gameId}-${row.playerId}-${row.propType}`,
    gameDate,
    gameId,
    matchup: `${boxScore.visitor_team.team.abbreviation} @ ${boxScore.home_team.team.abbreviation}`,
    playerId: row.playerId,
    playerName: row.playerName,
    teamAbbreviation: row.teamAbbreviation,
    propType: row.propType,
    label: row.label,
    side,
    line: row.lineValue,
    americanOdds,
    vendor,
    modelProbability,
    evPercent,
    foundAt: nowIso,
    clockLabel: clockLabelFor(clock),
    period: clock.isHalftime ? 2 : clock.period,
    scoreMargin,
    valueAtPick: row.currentValue,
    projection: row.projection.projection,
    latestValue: row.currentValue,
    tags: [...(isBestBet(evPercent, modelProbability) ? [bestBetTag] : []), ...pickTags(row, clock, side, scoreMargin)],
    result: null,
  };
}

export function isBestBet(evPercent: number, modelProbability: number): boolean {
  return evPercent >= bestBetRule.minimumEvPercent && modelProbability >= bestBetRule.minimumModelProbability;
}

export function findBoxPlayer(boxScore: BdlBoxScore, playerId: number): BdlBoxScorePlayer | null {
  return [...boxScore.home_team.players, ...boxScore.visitor_team.players].find((boxPlayer) => boxPlayer.player.id === playerId) ?? null;
}

export function currentStat(boxScore: BdlBoxScore, pick: Pick<LiveBetPick, "playerId" | "propType">): number | null {
  const mapping = propMapping(pick.propType);
  const boxPlayer = findBoxPlayer(boxScore, pick.playerId);
  if (!mapping || !boxPlayer) return null;
  return boxMetricValue(boxPlayer, mapping.metric);
}

export function gradeLiveBet(pick: LiveBetPick, finalBoxScore: BdlBoxScore, nowIso: string): LiveBetPick {
  const boxPlayer = findBoxPlayer(finalBoxScore, pick.playerId);
  const actual = currentStat(finalBoxScore, pick);
  if (!boxPlayer || actual === null || parseMinutes(boxPlayer.min) === 0) return { ...pick, result: { status: "void", actual: null, gradedAt: nowIso } };
  const status: LiveBetStatus = actual === pick.line ? "push" : (actual > pick.line) === (pick.side === "over") ? "win" : "loss";
  return { ...pick, latestValue: actual, result: { status, actual, gradedAt: nowIso } };
}

export interface LiveRecordSummary {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number | null;
  units: number;
  roiPercent: number | null;
  averageModel: number | null;
}

export function summarizeLiveBets(picks: LiveBetPick[]): LiveRecordSummary {
  const decided = picks.filter((pick) => pick.result?.status === "win" || pick.result?.status === "loss");
  const wins = decided.filter((pick) => pick.result!.status === "win").length;
  const units = decided.reduce((runningTotal, pick) => runningTotal + (pick.result!.status === "win" ? (pick.americanOdds > 0 ? pick.americanOdds / 100 : 100 / -pick.americanOdds) : -1), 0);
  return {
    picks: picks.length,
    wins,
    losses: decided.length - wins,
    pushes: picks.filter((pick) => pick.result?.status === "push").length,
    pending: picks.filter((pick) => !pick.result).length,
    winRate: decided.length > 0 ? wins / decided.length : null,
    units,
    roiPercent: decided.length > 0 ? (units / decided.length) * 100 : null,
    averageModel: decided.length > 0 ? decided.reduce((runningTotal, pick) => runningTotal + pick.modelProbability, 0) / decided.length : null,
  };
}

export function groupLiveBets(picks: LiveBetPick[], keyOf: (pick: LiveBetPick) => string | string[]): Array<{ key: string; summary: LiveRecordSummary }> {
  const grouped = new Map<string, LiveBetPick[]>();
  for (const pick of picks) {
    const keys = keyOf(pick);
    for (const key of Array.isArray(keys) ? keys : [keys]) grouped.set(key, [...(grouped.get(key) ?? []), pick]);
  }
  return [...grouped.entries()].map(([key, groupPicks]) => ({ key, summary: summarizeLiveBets(groupPicks) }));
}

export function evBucketLabel(evPercent: number): string {
  if (evPercent < 5) return "3-5% EV";
  if (evPercent < 10) return "5-10% EV";
  if (evPercent < 15) return "10-15% EV";
  return "15-25% EV";
}

export function chanceBucketLabel(probability: number): string {
  const lower = Math.floor(probability * 10) * 10;
  return `${lower}-${lower + 10}% model`;
}

export function combineLivePicks(history: LiveBetPick[], tonight: LiveBetPick[]): LiveBetPick[] {
  const byId = new Map(history.map((pick) => [pick.pickId, pick]));
  for (const pick of tonight) if (!byId.get(pick.pickId)?.result) byId.set(pick.pickId, pick); // a graded copy in the history wins
  return [...byId.values()].sort((first, second) => second.foundAt.localeCompare(first.foundAt));
}
