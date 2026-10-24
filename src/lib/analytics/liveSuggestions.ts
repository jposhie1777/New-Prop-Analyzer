import type { BdlBoxScore, BdlPlayerProp } from "@/lib/bdl/types";
import type { QuarterProfile } from "./aggregates/playerAggregates";
import { propMapping } from "./propTypes";
import { evaluateProp, type PropEvaluation } from "./halftime";
import { expectedValuePercent } from "@/lib/math/odds";
import { boxMetricValue } from "./halftimeSuggestions";
import { parseGameClock, projectLiveStat, type GameClock, type LiveProjectionResult } from "./liveProjection";
import { summarizePropMarkets } from "@/lib/client/pickBuilders";
import { parseMinutes } from "@/lib/dates";

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
  projection: LiveProjectionResult;
  evaluation: PropEvaluation;
  bestOverOdds: number | null;
  bestOverVendor: string | null;
  bestUnderOdds: number | null;
  bestUnderVendor: string | null;
  vendorCount: number;
  flagged: boolean;
}

export function settleCashedOver(evaluation: PropEvaluation, currentValue: number, lineValue: number, overOdds: number | null, underOdds: number | null): PropEvaluation {
  if (currentValue <= lineValue) return evaluation;
  const overEvPercent = overOdds !== null ? expectedValuePercent(1, overOdds) : null; // stats only go up, so the over has already won
  const underEvPercent = underOdds !== null ? -100 : null;
  return { ...evaluation, overProbability: 1, underProbability: 0, overEvPercent, underEvPercent, bestSide: overOdds !== null ? "over" : evaluation.bestSide, bestEvPercent: overEvPercent ?? underEvPercent };
}

export function buildLivePropRows(boxScore: BdlBoxScore, props: BdlPlayerProp[], profiles: Map<number, QuarterProfile>, evThresholdPercent: number): { rows: LivePropRow[]; clock: GameClock } {
  const clock = parseGameClock(boxScore.status, boxScore.time, boxScore.period);
  const margin = boxScore.home_team_score - boxScore.visitor_team_score;
  const summaries = summarizePropMarkets(props);
  const rows: LivePropRow[] = [];
  for (const side of [boxScore.visitor_team, boxScore.home_team]) {
    const sideMargin = side === boxScore.home_team ? margin : -margin;
    for (const boxPlayer of side.players) {
      const profile = profiles.get(boxPlayer.player.id);
      for (const summary of summaries.filter((candidate) => candidate.playerId === boxPlayer.player.id)) {
        const mapping = propMapping(summary.propType);
        if (!mapping || mapping.scope !== "FG") continue; // quarter props settle too fast to project here
        const currentValue = boxMetricValue(boxPlayer, mapping.metric);
        const rates = {
          averages: { 1: profile?.quarters[1]?.[mapping.metric]?.average ?? 0, 2: profile?.quarters[2]?.[mapping.metric]?.average ?? 0, 3: profile?.quarters[3]?.[mapping.metric]?.average ?? 0, 4: profile?.quarters[4]?.[mapping.metric]?.average ?? 0 },
          variances: { 1: profile?.quarters[1]?.[mapping.metric]?.variance ?? 0, 2: profile?.quarters[2]?.[mapping.metric]?.variance ?? 0, 3: profile?.quarters[3]?.[mapping.metric]?.variance ?? 0, 4: profile?.quarters[4]?.[mapping.metric]?.variance ?? 0 },
        };
        const projection = projectLiveStat(currentValue, rates, clock, boxPlayer.pf ?? 0, sideMargin);
        const evaluation = settleCashedOver(evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null), currentValue, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null);
        const fairPrices = summary.overOddsAtMain !== null && summary.underOddsAtMain !== null ? evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.overOddsAtMain, summary.underOddsAtMain) : null;
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
          projection,
          evaluation: { ...evaluation, noVigOver: fairPrices?.noVigOver ?? evaluation.noVigOver, noVigUnder: fairPrices?.noVigUnder ?? evaluation.noVigUnder },
          bestOverOdds: summary.bestOver?.odds ?? null,
          bestOverVendor: summary.bestOver?.vendor ?? null,
          bestUnderOdds: summary.bestUnder?.odds ?? null,
          bestUnderVendor: summary.bestUnder?.vendor ?? null,
          vendorCount: summary.vendorCount,
          flagged: profile !== undefined && profile.games >= 3 && currentValue <= summary.mainLine && (evaluation.bestEvPercent ?? -Infinity) >= evThresholdPercent, // no flag without history or on an already-cashed (stale) line
        });
      }
    }
  }
  return { rows, clock };
}
