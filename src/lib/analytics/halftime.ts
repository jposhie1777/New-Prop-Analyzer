import { appSettings } from "@/config/appSettings";
import { expectedValuePercent, noVigTwoWay } from "@/lib/math/odds";
import { probabilityOver, probabilityUnder } from "@/lib/math/probability";

export interface HalftimeContext {
  firstHalfActual: number;
  secondHalfAverage: number;
  secondHalfDeviation: number | null;
  secondHalfMinutesAverage: number | null;
  personalFouls: number;
  scoreMargin: number; // absolute halftime margin
}

export interface HalftimeProjection {
  projection: number;
  standardDeviation: number;
  minutesFactor: number;
  adjustments: string[];
}

export function minutesFactorFor(personalFouls: number, scoreMargin: number): { factor: number; adjustments: string[] } {
  let factor = 1;
  const adjustments: string[] = [];
  if (personalFouls >= 4) {
    factor *= 0.7;
    adjustments.push(`${personalFouls} fouls: 2nd-half minutes x0.70`);
  } else if (personalFouls === 3) {
    factor *= 0.85;
    adjustments.push("3 fouls: 2nd-half minutes x0.85");
  }
  if (Math.abs(scoreMargin) >= appSettings.blowoutMargin) {
    factor *= 0.8;
    adjustments.push(`margin ${Math.abs(scoreMargin)}: blowout risk x0.80`);
  }
  return { factor: Math.max(0.5, factor), adjustments };
}

export function projectHalftime(context: HalftimeContext): HalftimeProjection {
  const { factor, adjustments } = minutesFactorFor(context.personalFouls, context.scoreMargin);
  const secondHalfExpected = context.secondHalfAverage * factor; // per-minute production held constant, fewer minutes
  const baseDeviation = context.secondHalfDeviation ?? Math.max(1, Math.sqrt(Math.max(context.secondHalfAverage, 0.5))); // Poisson-like fallback
  return {
    projection: context.firstHalfActual + secondHalfExpected,
    standardDeviation: Math.max(0.75, baseDeviation * Math.sqrt(factor)),
    minutesFactor: factor,
    adjustments,
  };
}

export interface PropEvaluation {
  overProbability: number;
  underProbability: number;
  noVigOver: number | null;
  noVigUnder: number | null;
  overEvPercent: number | null;
  underEvPercent: number | null;
  bestSide: "over" | "under" | null;
  bestEvPercent: number | null;
}

export function evaluateProp(projection: number, standardDeviation: number, lineValue: number, overOdds: number | null, underOdds: number | null): PropEvaluation {
  const overProbability = probabilityOver(lineValue, projection, standardDeviation);
  const underProbability = probabilityUnder(lineValue, projection, standardDeviation);
  const hasBothSides = overOdds !== null && underOdds !== null;
  const overEvPercent = overOdds !== null ? expectedValuePercent(overProbability, overOdds) : null;
  const underEvPercent = underOdds !== null ? expectedValuePercent(underProbability, underOdds) : null;
  const candidates = [
    { side: "over" as const, ev: overEvPercent },
    { side: "under" as const, ev: underEvPercent },
  ].filter((candidate): candidate is { side: "over" | "under"; ev: number } => candidate.ev !== null);
  const best = candidates.sort((first, second) => second.ev - first.ev)[0] ?? null;
  return {
    overProbability,
    underProbability,
    noVigOver: hasBothSides ? noVigTwoWay(overOdds, underOdds) : null, // the market's fair price after removing the vig
    noVigUnder: hasBothSides ? noVigTwoWay(underOdds, overOdds) : null,
    overEvPercent,
    underEvPercent,
    bestSide: best?.side ?? null,
    bestEvPercent: best?.ev ?? null,
  };
}
