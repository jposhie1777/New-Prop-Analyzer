import type { BdlBettingOdd } from "@/lib/bdl/types";
import type { LeagueRatings, TeamRating } from "./aggregates/teamRatings";
import type { RestInfo } from "./aggregates/teamAggregates";
import { normalCdf } from "@/lib/math/probability";
import { expectedValuePercent, noVigTwoWay } from "@/lib/math/odds";
import { median } from "@/lib/odds/consensus";
import type { GameSelection } from "@/lib/client/pickBuilders";

export const homeCourtPoints = 2; // recent NBA home edge in final margin
export const backToBackPoints = 1.5; // margin cost of playing the second night of a back-to-back
export const restEdgePoints = 0.5;
export const marginDeviation = 12.5; // spread of final margins around the expectation
export const totalDeviation = 17; // spread of final totals around the expectation
export const injuryReplacementShare = 0.75; // teammates make up about 75% of a missing scorer's points, so a 25-point scorer is worth about 6
export const injuryCapPoints = 8;
const tooFarSpread = 6; // gaps this big usually mean news the model has not seen
const tooFarTotal = 10;
const tooFarWinChance = 0.15;

export interface InjuryImpact {
  playerName: string;
  status: string;
  pointsLost: number;
}

export interface GameContext {
  homeRest: RestInfo | undefined;
  awayRest: RestInfo | undefined;
  homeInjuries: InjuryImpact[];
  awayInjuries: InjuryImpact[];
}

export interface ProjectionFactor {
  label: string;
  marginEffect: number; // + helps the home team
  totalEffect: number;
}

export interface GameProjection {
  pace: number;
  homePoints: number;
  awayPoints: number;
  margin: number; // home minus away
  total: number;
  homeWinProbability: number;
  factors: ProjectionFactor[];
}

export interface LineEdge {
  market: "spread" | "total" | "moneyline";
  selection: GameSelection;
  sideLabel: string;
  line: number | null;
  americanOdds: number;
  vendor: string;
  modelProbability: number;
  marketProbability: number | null; // no-vig chance at that book
  evPercent: number;
  fairText: string; // the model's own line
  marketText: string; // the consensus line
  marketValue: number | null; // consensus home spread, total, or no-vig home win chance
  tooFar: boolean;
  flagged: boolean;
}

export const injuryStatusWeights: Array<[RegExp, number]> = [
  [/out/i, 1],
  [/doubtful/i, 0.75],
  [/questionable/i, 0.4],
  [/day.to.day/i, 0.25],
];

export function injuryWeight(status: string): number {
  return injuryStatusWeights.find(([statusPattern]) => statusPattern.test(status))?.[1] ?? 0;
}

function restEffect(ownRest: RestInfo | undefined, otherRest: RestInfo | undefined): number {
  let effect = 0;
  if (ownRest?.backToBack) effect -= backToBackPoints;
  const ownDays = ownRest?.restDays ?? null;
  const otherDays = otherRest?.restDays ?? null;
  if (ownDays !== null && otherDays !== null && ownDays <= 5 && ownDays - otherDays >= 2 && otherDays <= 1) effect += restEdgePoints; // well rested against a tired team
  return effect;
}

export function projectGame(home: TeamRating, away: TeamRating, league: Pick<LeagueRatings, "offense" | "pace">, context: GameContext): GameProjection {
  const pace = (home.blended.pace * away.blended.pace) / league.pace; // two fast teams play faster than either alone
  const homeBase = (pace / 100) * ((home.blended.offense * away.blended.defense) / league.offense);
  const awayBase = (pace / 100) * ((away.blended.offense * home.blended.defense) / league.offense);
  const factors: ProjectionFactor[] = [{ label: `Home court +${homeCourtPoints}`, marginEffect: homeCourtPoints, totalEffect: 0 }];
  const homeRestEffect = restEffect(context.homeRest, context.awayRest);
  const awayRestEffect = restEffect(context.awayRest, context.homeRest);
  if (homeRestEffect !== 0) factors.push({ label: context.homeRest?.backToBack ? "Home on a back-to-back" : "Home rest edge", marginEffect: homeRestEffect, totalEffect: context.homeRest?.backToBack ? -0.5 : 0 });
  if (awayRestEffect !== 0) factors.push({ label: context.awayRest?.backToBack ? "Away on a back-to-back" : "Away rest edge", marginEffect: -awayRestEffect, totalEffect: context.awayRest?.backToBack ? -0.5 : 0 });
  const homeInjuryPoints = Math.min(injuryCapPoints, context.homeInjuries.reduce((runningTotal, injury) => runningTotal + injury.pointsLost, 0));
  const awayInjuryPoints = Math.min(injuryCapPoints, context.awayInjuries.reduce((runningTotal, injury) => runningTotal + injury.pointsLost, 0));
  if (homeInjuryPoints > 0) factors.push({ label: `Home missing ${context.homeInjuries.map((injury) => injury.playerName).join(", ")}`, marginEffect: -homeInjuryPoints, totalEffect: -homeInjuryPoints });
  if (awayInjuryPoints > 0) factors.push({ label: `Away missing ${context.awayInjuries.map((injury) => injury.playerName).join(", ")}`, marginEffect: awayInjuryPoints, totalEffect: -awayInjuryPoints });
  const marginAdjustment = factors.reduce((runningTotal, factor) => runningTotal + factor.marginEffect, 0);
  const totalAdjustment = factors.reduce((runningTotal, factor) => runningTotal + factor.totalEffect, 0);
  const total = homeBase + awayBase + totalAdjustment;
  const margin = homeBase - awayBase + marginAdjustment;
  return { pace, homePoints: (total + margin) / 2, awayPoints: (total - margin) / 2, margin, total, homeWinProbability: normalCdf(margin / marginDeviation), factors };
}

export function selectionProbability(projection: Pick<GameProjection, "margin" | "total">, selection: GameSelection, line: number | null): number | null {
  switch (selection) {
    case "spread_home":
      return line === null ? null : 1 - normalCdf(-line, projection.margin, marginDeviation); // home covers when margin + line > 0
    case "spread_away":
      return line === null ? null : normalCdf(line, projection.margin, marginDeviation); // away covers when margin < line
    case "total_over":
      return line === null ? null : 1 - normalCdf(line, projection.total, totalDeviation);
    case "total_under":
      return line === null ? null : normalCdf(line, projection.total, totalDeviation);
    case "moneyline_home":
      return normalCdf(projection.margin / marginDeviation);
    case "moneyline_away":
      return 1 - normalCdf(projection.margin / marginDeviation);
  }
}

interface SelectionQuote {
  line: number | null;
  odds: number | null;
  otherOdds: number | null;
}

function quoteFor(bettingOdd: BdlBettingOdd, selection: GameSelection): SelectionQuote {
  const numberOrNull = (rawValue: string | null) => (rawValue === null || rawValue === "" || !Number.isFinite(Number(rawValue)) ? null : Number(rawValue));
  switch (selection) {
    case "spread_home":
      return { line: numberOrNull(bettingOdd.spread_home_value), odds: bettingOdd.spread_home_odds, otherOdds: bettingOdd.spread_away_odds };
    case "spread_away":
      return { line: numberOrNull(bettingOdd.spread_away_value), odds: bettingOdd.spread_away_odds, otherOdds: bettingOdd.spread_home_odds };
    case "total_over":
      return { line: numberOrNull(bettingOdd.total_value), odds: bettingOdd.total_over_odds, otherOdds: bettingOdd.total_under_odds };
    case "total_under":
      return { line: numberOrNull(bettingOdd.total_value), odds: bettingOdd.total_under_odds, otherOdds: bettingOdd.total_over_odds };
    case "moneyline_home":
      return { line: null, odds: bettingOdd.moneyline_home_odds, otherOdds: bettingOdd.moneyline_away_odds };
    case "moneyline_away":
      return { line: null, odds: bettingOdd.moneyline_away_odds, otherOdds: bettingOdd.moneyline_home_odds };
  }
}

function isRealSpread(spreadValue: number): boolean {
  return Math.abs(spreadValue) < 40; // ignore placeholder spreads
}

function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function evaluateGameLines(projection: GameProjection, odds: BdlBettingOdd[], homeAbbreviation: string, awayAbbreviation: string, evThresholdPercent: number): LineEdge[] {
  const consensusSpreadHome = median(odds.map((bettingOdd) => Number(bettingOdd.spread_home_value)).filter((value) => Number.isFinite(value) && isRealSpread(value)));
  const consensusTotal = median(odds.map((bettingOdd) => Number(bettingOdd.total_value)).filter((value) => Number.isFinite(value) && value > 100));
  const homeNoVig = median(odds.filter((bettingOdd) => bettingOdd.moneyline_home_odds && bettingOdd.moneyline_away_odds).map((bettingOdd) => noVigTwoWay(bettingOdd.moneyline_home_odds!, bettingOdd.moneyline_away_odds!)));
  const marketTexts = {
    spread: consensusSpreadHome === null ? "–" : `${homeAbbreviation} ${signed(consensusSpreadHome)}`,
    total: consensusTotal === null ? "–" : String(consensusTotal),
    moneyline: homeNoVig === null ? "–" : `${homeAbbreviation} ${Math.round(homeNoVig * 100)}%`,
  };
  const fairTexts = {
    spread: `${homeAbbreviation} ${signed(-projection.margin)}`,
    total: projection.total.toFixed(1),
    moneyline: `${homeAbbreviation} ${Math.round(projection.homeWinProbability * 100)}%`,
  };
  const tooFar = {
    spread: consensusSpreadHome !== null && Math.abs(-projection.margin - consensusSpreadHome) > tooFarSpread,
    total: consensusTotal !== null && Math.abs(projection.total - consensusTotal) > tooFarTotal,
    moneyline: homeNoVig !== null && Math.abs(projection.homeWinProbability - homeNoVig) > tooFarWinChance,
  };
  const selections: Array<{ market: LineEdge["market"]; selection: GameSelection; sideLabel: (line: number | null) => string }> = [
    { market: "spread", selection: "spread_home", sideLabel: (line) => `${homeAbbreviation} ${line === null ? "" : signed(line)}` },
    { market: "spread", selection: "spread_away", sideLabel: (line) => `${awayAbbreviation} ${line === null ? "" : signed(line)}` },
    { market: "total", selection: "total_over", sideLabel: (line) => `Over ${line ?? ""}` },
    { market: "total", selection: "total_under", sideLabel: (line) => `Under ${line ?? ""}` },
    { market: "moneyline", selection: "moneyline_home", sideLabel: () => `${homeAbbreviation} ML` },
    { market: "moneyline", selection: "moneyline_away", sideLabel: () => `${awayAbbreviation} ML` },
  ];
  const edges: LineEdge[] = [];
  for (const { market, selection, sideLabel } of selections) {
    let best: LineEdge | null = null;
    for (const bettingOdd of odds) {
      const quote = quoteFor(bettingOdd, selection);
      if (quote.odds === null || quote.odds === 0 || !Number.isFinite(quote.odds)) continue;
      if (market !== "moneyline" && quote.line === null) continue;
      const modelProbability = selectionProbability(projection, selection, quote.line);
      if (modelProbability === null) continue;
      const evPercent = expectedValuePercent(modelProbability, quote.odds);
      if (best && evPercent <= best.evPercent) continue;
      best = {
        market,
        selection,
        sideLabel: sideLabel(quote.line),
        line: quote.line,
        americanOdds: quote.odds,
        vendor: bettingOdd.vendor,
        modelProbability,
        marketProbability: quote.otherOdds ? noVigTwoWay(quote.odds, quote.otherOdds) : null,
        evPercent,
        fairText: fairTexts[market],
        marketText: marketTexts[market],
        marketValue: market === "spread" ? consensusSpreadHome : market === "total" ? consensusTotal : homeNoVig,
        tooFar: tooFar[market],
        flagged: !tooFar[market] && evPercent >= evThresholdPercent,
      };
    }
    if (best) edges.push(best);
  }
  return edges;
}
