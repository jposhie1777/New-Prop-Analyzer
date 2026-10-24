import type { BdlBoxScore, BdlBoxScorePlayer, BdlPlayerProp } from "@/lib/bdl/types";
import type { SecondHalfProfile } from "./aggregates/playerAggregates";
import { propMapping } from "./propTypes";
import { evaluateProp, projectHalftime, type HalftimeProjection, type PropEvaluation } from "./halftime";
import { summarizePropMarkets } from "@/lib/client/pickBuilders";
import type { PlayerMetric } from "./views";
import { parseMinutes } from "@/lib/dates";
import { settleCashedOver } from "./liveSuggestions";

export interface HalftimeSuggestion {
  playerId: number;
  playerName: string;
  teamId: number;
  propType: string;
  lineValue: number;
  firstHalfActual: number;
  secondHalfAverage: number;
  secondHalfMinutesAverage: number | null;
  firstHalfMinutes: number;
  personalFouls: number;
  margin: number;
  sampleGames: number;
  projection: HalftimeProjection;
  evaluation: PropEvaluation;
  bestOverOdds: number | null;
  bestOverVendor: string | null;
  bestUnderOdds: number | null;
  bestUnderVendor: string | null;
  flagged: boolean;
}

function withinMarketGap(modelOver: number, fairOver: number | null): boolean {
  return fairOver !== null && Math.abs(modelOver - fairOver) <= 0.2;
}

export function boxMetricValue(boxPlayer: BdlBoxScorePlayer, metric: PlayerMetric): number {
  const points = boxPlayer.pts ?? 0;
  const rebounds = boxPlayer.reb ?? 0;
  const assists = boxPlayer.ast ?? 0;
  const combos: Partial<Record<PlayerMetric, number>> = {
    pra: points + rebounds + assists,
    pr: points + rebounds,
    pa: points + assists,
    ra: rebounds + assists,
    stocks: (boxPlayer.stl ?? 0) + (boxPlayer.blk ?? 0),
    minutes: parseMinutes(boxPlayer.min),
  };
  if (metric in combos) return combos[metric]!;
  return Number((boxPlayer as unknown as Record<string, unknown>)[metric] ?? 0);
}

export function buildHalftimeSuggestions(boxScore: BdlBoxScore, props: BdlPlayerProp[], profiles: Map<number, SecondHalfProfile>, evThresholdPercent: number): HalftimeSuggestion[] {
  const margin = Math.abs(boxScore.home_team_score - boxScore.visitor_team_score);
  const summaries = summarizePropMarkets(props);
  const suggestions: HalftimeSuggestion[] = [];
  for (const side of [boxScore.home_team, boxScore.visitor_team]) {
    for (const boxPlayer of side.players) {
      const profile = profiles.get(boxPlayer.player.id);
      if (!profile || profile.games === 0) continue;
      for (const summary of summaries.filter((candidate) => candidate.playerId === boxPlayer.player.id)) {
        const mapping = propMapping(summary.propType);
        if (!mapping || mapping.scope !== "FG") continue; // only full-game props can still be won after halftime
        const secondHalf = profile.metrics[mapping.metric];
        if (secondHalf.average === null) continue;
        const projection = projectHalftime({
          firstHalfActual: boxMetricValue(boxPlayer, mapping.metric),
          secondHalfAverage: secondHalf.average,
          secondHalfDeviation: secondHalf.standardDeviation,
          secondHalfMinutesAverage: profile.metrics.minutes.average,
          personalFouls: boxPlayer.pf ?? 0,
          scoreMargin: margin,
        });
        const firstHalfValue = boxMetricValue(boxPlayer, mapping.metric);
        const evaluation = settleCashedOver(evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null), firstHalfValue, summary.mainLine, summary.bestOver?.odds ?? null, summary.bestUnder?.odds ?? null);
        const noVig = summary.overOddsAtMain !== null && summary.underOddsAtMain !== null ? evaluateProp(projection.projection, projection.standardDeviation, summary.mainLine, summary.overOddsAtMain, summary.underOddsAtMain) : null;
        suggestions.push({
          playerId: boxPlayer.player.id,
          playerName: `${boxPlayer.player.first_name} ${boxPlayer.player.last_name}`,
          teamId: side.team.id,
          propType: summary.propType,
          lineValue: summary.mainLine,
          firstHalfActual: boxMetricValue(boxPlayer, mapping.metric),
          secondHalfAverage: secondHalf.average,
          secondHalfMinutesAverage: profile.metrics.minutes.average,
          firstHalfMinutes: parseMinutes(boxPlayer.min),
          personalFouls: boxPlayer.pf ?? 0,
          margin,
          sampleGames: profile.games,
          projection,
          evaluation: { ...evaluation, noVigOver: noVig?.noVigOver ?? evaluation.noVigOver, noVigUnder: noVig?.noVigUnder ?? evaluation.noVigUnder }, // fair price from the consensus market, EV at the best price
          bestOverOdds: summary.bestOver?.odds ?? null,
          bestOverVendor: summary.bestOver?.vendor ?? null,
          bestUnderOdds: summary.bestUnder?.odds ?? null,
          bestUnderVendor: summary.bestUnder?.vendor ?? null,
          flagged: firstHalfValue <= summary.mainLine && withinMarketGap(evaluation.overProbability, noVig?.noVigOver ?? evaluation.noVigOver) && (evaluation.bestEvPercent ?? -Infinity) >= evThresholdPercent, // a cashed line is stale; a huge gap to the market means missing news
        });
      }
    }
  }
  return suggestions.sort((first, second) => (second.evaluation.bestEvPercent ?? -999) - (first.evaluation.bestEvPercent ?? -999));
}
