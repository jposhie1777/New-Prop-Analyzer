import { normalCdf } from "@/lib/math/probability";
import { marginDeviation, totalDeviation } from "./gameModel";

export interface LineSample {
  gameId: number;
  gameDate: string;
  season: number;
  modelMargin: number; // raw model, home minus away, built only from earlier games
  modelTotal: number;
  marketMargin: number | null; // opening consensus: a home spread of -5 means +5
  marketTotal: number | null;
  actualMargin: number;
  actualTotal: number;
}

export interface LearnedParameters {
  sampleCount: number;
  marginBias: number; // add to the raw model margin
  totalBias: number;
  marginTrust: number; // 0 = copy the market, 1 = use the model as is
  totalTrust: number;
  marginDeviation: number;
  totalDeviation: number;
}

export interface LearnedLine {
  margin: number;
  total: number;
  homeWinProbability: number;
  marginDeviation: number;
  totalDeviation: number;
}

export const learningPriors = {
  trust: 0.15, // before any evidence, lean on the market: last season the raw model missed totals by 16.3 and margins by 11.4 on average, worse than closing lines
  trustPriorGames: 150, // the evidence needs about this many games to outweigh the prior
  biasPriorGames: 50, // a steady miss is easy to measure, so it is corrected sooner
  deviationPriorGames: 150,
  windowGames: 900, // learn from the most recent games only, so old habits fade
};

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(highest, Math.max(lowest, value));
}

function learnSide(samples: LineSample[], side: "margin" | "total", defaultDeviation: number): { bias: number; trust: number; deviation: number } {
  const modelOf = (sample: LineSample) => (side === "margin" ? sample.modelMargin : sample.modelTotal);
  const marketOf = (sample: LineSample) => (side === "margin" ? sample.marketMargin : sample.marketTotal);
  const actualOf = (sample: LineSample) => (side === "margin" ? sample.actualMargin : sample.actualTotal);
  const count = samples.length;
  const rawBias = count > 0 ? samples.reduce((runningTotal, sample) => runningTotal + (actualOf(sample) - modelOf(sample)), 0) / count : 0;
  const bias = (rawBias * count) / (count + learningPriors.biasPriorGames); // a steady miss gets corrected, a few odd games do not
  const priced = samples.filter((sample) => marketOf(sample) !== null);
  let gapProduct = 0;
  let gapSquared = 0;
  for (const sample of priced) {
    const modelGap = modelOf(sample) + bias - marketOf(sample)!;
    gapProduct += modelGap * (actualOf(sample) - marketOf(sample)!);
    gapSquared += modelGap * modelGap;
  }
  const fittedTrust = gapSquared > 0 ? gapProduct / gapSquared : learningPriors.trust; // least squares: how much of the model's disagreement turned out right
  const trust = clamp((priced.length * clamp(fittedTrust, 0, 1) + learningPriors.trustPriorGames * learningPriors.trust) / (priced.length + learningPriors.trustPriorGames), 0, 1);
  let squaredMiss = 0;
  for (const sample of priced) {
    const fair = marketOf(sample)! + trust * (modelOf(sample) + bias - marketOf(sample)!);
    squaredMiss += (actualOf(sample) - fair) ** 2;
  }
  const deviation = Math.sqrt((squaredMiss + learningPriors.deviationPriorGames * defaultDeviation ** 2) / (priced.length + learningPriors.deviationPriorGames));
  return { bias, trust, deviation };
}

export function learnParameters(samples: LineSample[], beforeDate: string | null = null): LearnedParameters {
  const usable = samples
    .filter((sample) => beforeDate === null || sample.gameDate < beforeDate) // never learn from the day being predicted or later
    .sort((first, second) => second.gameDate.localeCompare(first.gameDate))
    .slice(0, learningPriors.windowGames);
  const margin = learnSide(usable, "margin", marginDeviation);
  const total = learnSide(usable, "total", totalDeviation);
  return { sampleCount: usable.length, marginBias: margin.bias, totalBias: total.bias, marginTrust: margin.trust, totalTrust: total.trust, marginDeviation: margin.deviation, totalDeviation: total.deviation };
}

export function applyLearning(raw: { margin: number; total: number }, market: { margin: number | null; total: number | null }, parameters: LearnedParameters): LearnedLine {
  const adjustedMargin = raw.margin + parameters.marginBias;
  const adjustedTotal = raw.total + parameters.totalBias;
  const margin = market.margin === null ? adjustedMargin : market.margin + parameters.marginTrust * (adjustedMargin - market.margin);
  const total = market.total === null ? adjustedTotal : market.total + parameters.totalTrust * (adjustedTotal - market.total);
  return { margin, total, homeWinProbability: normalCdf(margin / parameters.marginDeviation), marginDeviation: parameters.marginDeviation, totalDeviation: parameters.totalDeviation };
}
