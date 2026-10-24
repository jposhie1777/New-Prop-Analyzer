import type { BdlBettingOdd } from "@/lib/bdl/types";

export function median(values: number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value)).sort((first, second) => first - second);
  if (finiteValues.length === 0) return null;
  const middleIndex = Math.floor(finiteValues.length / 2);
  return finiteValues.length % 2 === 1 ? finiteValues[middleIndex] : (finiteValues[middleIndex - 1] + finiteValues[middleIndex]) / 2;
}

function numericValues(odds: BdlBettingOdd[], fieldName: keyof BdlBettingOdd): number[] {
  return odds.map((odd) => odd[fieldName]).filter((rawValue) => rawValue !== null && rawValue !== undefined && rawValue !== "").map(Number).filter(Number.isFinite);
}

export interface ConsensusLine {
  spreadHome: number | null;
  total: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  vendorCount: number;
}

export function consensusLine(odds: BdlBettingOdd[]): ConsensusLine {
  return {
    spreadHome: median(numericValues(odds, "spread_home_value")),
    total: median(numericValues(odds, "total_value")),
    moneylineHome: median(numericValues(odds, "moneyline_home_odds")),
    moneylineAway: median(numericValues(odds, "moneyline_away_odds")),
    vendorCount: new Set(odds.map((odd) => odd.vendor)).size,
  };
}

export function impliedTeamTotals(spreadHome: number | null, total: number | null): { home: number | null; away: number | null } {
  if (spreadHome === null || total === null) return { home: null, away: null };
  return { home: (total - spreadHome) / 2, away: (total + spreadHome) / 2 }; // home -5 on 220 -> 112.5 vs 107.5
}

export function groupOddsByGame(odds: BdlBettingOdd[]): Map<number, BdlBettingOdd[]> {
  const grouped = new Map<number, BdlBettingOdd[]>();
  for (const odd of odds) grouped.set(odd.game_id, [...(grouped.get(odd.game_id) ?? []), odd]);
  return grouped;
}
