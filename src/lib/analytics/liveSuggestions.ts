import type { BdlBoxScore, BdlPlayerProp } from "@/lib/bdl/types";
import type { QuarterProfile } from "./aggregates/playerAggregates";
import { propMapping } from "./propTypes";
import { evaluateProp, type PropEvaluation } from "./halftime";
import { boxMetricValue } from "./halftimeSuggestions";
import { normalizeShares, parseGameClock, restOfGameAverage, projectLiveStat, statDispersion, type GameClock, type LivePrior, type LiveProjectionResult } from "./liveProjection";
import { summarizePropMarkets, type PropMarketSummary } from "@/lib/client/pickBuilders";
import { expectedValuePercent } from "@/lib/math/odds";
import { probabilityAtLeast } from "@/lib/math/probability";
import { parseMinutes } from "@/lib/dates";
import type { PlayerMetric } from "./views";

export const maximumModelMarketGap = 0.2; // bigger disagreements usually mean the model is missing news, not an edge

export interface LadderRow {
  line: number;
  overOdds: number | null;
  overVendor: string | null;
  underOdds: number | null;
  underVendor: string | null;
  overProbability: number;
  underProbability: number;
  overEvPercent: number | null;
  underEvPercent: number | null;
  books: number;
}

export interface MilestoneRow {
  threshold: number;
  odds: number;
  vendor: string;
  probability: number;
  evPercent: number;
  books: number;
}

export interface LivePropRow {
  playerId: number;
  playerName: string;
  teamId: number;
  teamAbbreviation: string;
  propType: string;
  label: string;
  lineValue: number;
  currentValue: number;
  needed: number;
  minutesPlayed: number;
  personalFouls: number;
  sampleGames: number;
  restOfGame: { value: number; label: string } | null; // the player's last-10 average for the quarters still to play
  prior: LivePrior;
  projection: LiveProjectionResult;
  evaluation: PropEvaluation;
  modelMarketGap: number | null;
  bestOverOdds: number | null;
  bestOverVendor: string | null;
  bestUnderOdds: number | null;
  bestUnderVendor: string | null;
  vendorCount: number;
  ladder: LadderRow[];
  milestones: MilestoneRow[];
  flagged: boolean;
}

export function settleCashedOver(evaluation: PropEvaluation, currentValue: number, lineValue: number, overOdds: number | null, underOdds: number | null): PropEvaluation {
  if (currentValue <= lineValue) return evaluation;
  const overEvPercent = overOdds !== null ? expectedValuePercent(1, overOdds) : null; // stats only go up, so the over has already won
  const underEvPercent = underOdds !== null ? -100 : null;
  return { ...evaluation, overProbability: 1, underProbability: 0, overEvPercent, underEvPercent, bestSide: overOdds !== null ? "over" : evaluation.bestSide, bestEvPercent: overEvPercent ?? underEvPercent };
}

export function buildPrior(metric: PlayerMetric, propType: string, playerId: number, profile: QuarterProfile | undefined, openingSummaries: PropMarketSummary[]): LivePrior {
  const quarterAverages = [1, 2, 3, 4].map((quarter) => profile?.quarters[quarter as 1 | 2 | 3 | 4]?.[metric]?.average ?? 0) as [number, number, number, number];
  const lastTenTotal = quarterAverages.reduce((runningTotal, average) => runningTotal + average, 0);
  const opening = openingSummaries.find((summary) => summary.playerId === playerId && summary.propType === propType);
  return {
    fullGameMean: opening ? opening.mainLine : lastTenTotal,
    quarterShares: normalizeShares(quarterAverages),
    dispersion: statDispersion[metric] ?? 1.5,
    source: opening ? "pregame line" : "last 10",
  };
}

function evaluateLadder(summary: PropMarketSummary, projection: LiveProjectionResult, currentValue: number): { ladder: LadderRow[]; milestones: MilestoneRow[] } {
  const ladder = summary.ladder.map((rung) => {
    const evaluation = settleCashedOver(evaluateProp(projection.projection, projection.standardDeviation, rung.line, rung.bestOver?.odds ?? null, rung.bestUnder?.odds ?? null), currentValue, rung.line, rung.bestOver?.odds ?? null, rung.bestUnder?.odds ?? null);
    return {
      line: rung.line,
      overOdds: rung.bestOver?.odds ?? null,
      overVendor: rung.bestOver?.vendor ?? null,
      underOdds: rung.bestUnder?.odds ?? null,
      underVendor: rung.bestUnder?.vendor ?? null,
      overProbability: evaluation.overProbability,
      underProbability: evaluation.underProbability,
      overEvPercent: evaluation.overEvPercent,
      underEvPercent: evaluation.underEvPercent,
      books: rung.books,
    };
  });
  const milestones = summary.milestones.map((milestone) => {
    const probability = currentValue >= milestone.threshold ? 1 : probabilityAtLeast(milestone.threshold, projection.projection, projection.standardDeviation);
    return { threshold: milestone.threshold, odds: milestone.best.odds, vendor: milestone.best.vendor, probability, evPercent: expectedValuePercent(probability, milestone.best.odds), books: milestone.books };
  });
  return { ladder, milestones };
}

export function dedupeBoxPlayers<PlayerType extends { player: { id: number }; min: string | null }>(players: PlayerType[]): PlayerType[] {
  const byId = new Map<number, PlayerType>();
  for (const boxPlayer of players) {
    const existing = byId.get(boxPlayer.player.id);
    if (!existing || parseMinutes(boxPlayer.min) > parseMinutes(existing.min)) byId.set(boxPlayer.player.id, boxPlayer); // the live feed can list a player twice
  }
  return [...byId.values()];
}

export function buildLivePropRows(boxScore: BdlBoxScore, props: BdlPlayerProp[], openingProps: BdlPlayerProp[], profiles: Map<number, QuarterProfile>, evThresholdPercent: number): { rows: LivePropRow[]; clock: GameClock } {
  const clock = parseGameClock(boxScore.status, boxScore.time, boxScore.period);
  const margin = boxScore.home_team_score - boxScore.visitor_team_score;
  const summaries = summarizePropMarkets(props);
  const openingSummaries = summarizePropMarkets(openingProps);
  const rows: LivePropRow[] = [];
  for (const side of [boxScore.visitor_team, boxScore.home_team]) {
    const sideMargin = side === boxScore.home_team ? margin : -margin;
    for (const boxPlayer of dedupeBoxPlayers(side.players)) {
      const profile = profiles.get(boxPlayer.player.id);
      for (const summary of summaries.filter((candidate) => candidate.playerId === boxPlayer.player.id)) {
        const mapping = propMapping(summary.propType);
        if (!mapping || mapping.scope !== "FG") continue; // quarter props settle too fast to project here
        const currentValue = boxMetricValue(boxPlayer, mapping.metric);
        const prior = buildPrior(mapping.metric, summary.propType, boxPlayer.player.id, profile, openingSummaries);
        const projection = projectLiveStat(currentValue, prior, clock, boxPlayer.pf ?? 0, sideMargin);
        const evaluation = settleCashedOver(evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null), currentValue, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null);
        const fairPrices = summary.overOddsAtMain !== null && summary.underOddsAtMain !== null ? evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.overOddsAtMain, summary.underOddsAtMain) : null;
        const fairOver = fairPrices?.noVigOver ?? evaluation.noVigOver;
        const modelMarketGap = fairOver === null ? null : Math.abs(evaluation.overProbability - fairOver);
        const { ladder, milestones } = evaluateLadder(summary, projection, currentValue);
        const cashed = currentValue > summary.mainLine;
        rows.push({
          playerId: boxPlayer.player.id,
          playerName: `${boxPlayer.player.first_name} ${boxPlayer.player.last_name}`,
          teamId: side.team.id,
          teamAbbreviation: side.team.abbreviation,
          propType: summary.propType,
          label: mapping.label,
          lineValue: summary.mainLine,
          currentValue,
          needed: Math.max(0, Math.floor(summary.mainLine) + 1 - currentValue),
          minutesPlayed: parseMinutes(boxPlayer.min),
          personalFouls: boxPlayer.pf ?? 0,
          sampleGames: profile?.games ?? 0,
          restOfGame: restOfGameAverage(profile && [1, 2, 3, 4].every((quarter) => profile.quarters[quarter as 1 | 2 | 3 | 4]) ? ([1, 2, 3, 4].map((quarter) => profile.quarters[quarter as 1 | 2 | 3 | 4][mapping.metric].average) as [number, number, number, number]) : null, clock),
          prior,
          projection,
          evaluation: { ...evaluation, noVigOver: fairOver, noVigUnder: fairPrices?.noVigUnder ?? evaluation.noVigUnder },
          modelMarketGap,
          bestOverOdds: summary.bestOver?.odds ?? null,
          bestOverVendor: summary.bestOver?.vendor ?? null,
          bestUnderOdds: summary.bestUnder?.odds ?? null,
          bestUnderVendor: summary.bestUnder?.vendor ?? null,
          vendorCount: summary.vendorCount,
          ladder,
          milestones,
          flagged: !cashed && prior.source === "pregame line" && modelMarketGap !== null && modelMarketGap <= maximumModelMarketGap && (evaluation.bestEvPercent ?? -Infinity) >= evThresholdPercent, // only flag modest, explainable disagreements
        });
      }
    }
  }
  return { rows, clock };
}
