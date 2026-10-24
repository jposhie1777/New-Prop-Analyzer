import type { PlayerMetric, ScopeName } from "@/lib/analytics/views";

export type TrackSource = "halftime" | "live" | "100-in-3" | "slip";
export type TrackKind = "prop" | "spread" | "total" | "moneyline" | "team_three_quarters";
export type TrackSide = "over" | "under" | "home" | "away";
export type GradeStatus = "win" | "loss" | "push" | "void";

export interface TrackedPick {
  trackId: string;
  createdAt: string;
  source: TrackSource;
  kind: TrackKind;
  gameId: number;
  gameDate: string;
  label: string;
  side: TrackSide;
  lineValue: number | null;
  americanOdds: number | null;
  vendor: string | null;
  modelProbability: number | null;
  evPercent: number | null;
  playerId: number | null;
  teamId: number | null;
  propType: string | null;
  metric: PlayerMetric | null;
  scope: ScopeName | null;
  result: { status: GradeStatus; actual: number | null; gradedAt: string } | null;
}

export interface GradeInputs {
  actual: number | null; // stat, team points, or home margin for spreads and moneylines
  opponentActual?: number | null;
}

export function gradePick(pick: Pick<TrackedPick, "kind" | "side" | "lineValue">, inputs: GradeInputs): GradeStatus {
  if (inputs.actual === null || inputs.actual === undefined) return "void"; // did not play, or no data
  const actual = inputs.actual;
  if (pick.kind === "moneyline") {
    if (actual === 0) return "push";
    const homeWon = actual > 0;
    return (pick.side === "home") === homeWon ? "win" : "loss";
  }
  if (pick.lineValue === null) return "void";
  if (pick.kind === "spread") {
    const coverMargin = pick.side === "home" ? actual + pick.lineValue : -actual + pick.lineValue; // actual is home margin
    if (coverMargin === 0) return "push";
    return coverMargin > 0 ? "win" : "loss";
  }
  if (actual === pick.lineValue) return "push";
  const wentOver = actual > pick.lineValue;
  return (pick.side === "over") === wentOver ? "win" : "loss";
}

export function profitUnits(status: GradeStatus, americanOdds: number | null): number {
  if (status !== "win" && status !== "loss") return 0;
  if (status === "loss") return -1;
  if (americanOdds === null || americanOdds === 0) return 0.909; // assume -110 when no price was logged
  return americanOdds > 0 ? americanOdds / 100 : 100 / -americanOdds;
}

export interface RecordSummary {
  picks: number;
  graded: number;
  pending: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  winRate: number | null;
  unitsProfit: number;
  roiPercent: number | null;
  averageEvPercent: number | null;
  averageModelProbability: number | null;
  brierScore: number | null;
}

export function summarizeRecord(picks: TrackedPick[]): RecordSummary {
  const graded = picks.filter((pick) => pick.result);
  const decided = graded.filter((pick) => pick.result!.status === "win" || pick.result!.status === "loss");
  const wins = decided.filter((pick) => pick.result!.status === "win").length;
  const unitsProfit = decided.reduce((runningTotal, pick) => runningTotal + profitUnits(pick.result!.status, pick.americanOdds), 0);
  const withEv = picks.filter((pick) => pick.evPercent !== null);
  const withModel = decided.filter((pick) => pick.modelProbability !== null);
  return {
    picks: picks.length,
    graded: graded.length,
    pending: picks.length - graded.length,
    wins,
    losses: decided.length - wins,
    pushes: graded.filter((pick) => pick.result!.status === "push").length,
    voids: graded.filter((pick) => pick.result!.status === "void").length,
    winRate: decided.length > 0 ? wins / decided.length : null,
    unitsProfit,
    roiPercent: decided.length > 0 ? (unitsProfit / decided.length) * 100 : null, // flat 1-unit stakes
    averageEvPercent: withEv.length > 0 ? withEv.reduce((runningTotal, pick) => runningTotal + pick.evPercent!, 0) / withEv.length : null,
    averageModelProbability: withModel.length > 0 ? withModel.reduce((runningTotal, pick) => runningTotal + pick.modelProbability!, 0) / withModel.length : null,
    brierScore: withModel.length > 0 ? withModel.reduce((runningTotal, pick) => runningTotal + (pick.modelProbability! - (pick.result!.status === "win" ? 1 : 0)) ** 2, 0) / withModel.length : null, // lower is better, 0.25 = coin flip
  };
}

export interface CalibrationBucket {
  label: string;
  picks: number;
  predicted: number | null;
  actual: number | null;
}

export function calibrationBuckets(picks: TrackedPick[], edges = [0, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0001]): CalibrationBucket[] {
  const decided = picks.filter((pick) => pick.modelProbability !== null && (pick.result?.status === "win" || pick.result?.status === "loss"));
  const buckets: CalibrationBucket[] = [];
  for (let edgeIndex = 0; edgeIndex < edges.length - 1; edgeIndex++) {
    const inBucket = decided.filter((pick) => pick.modelProbability! >= edges[edgeIndex] && pick.modelProbability! < edges[edgeIndex + 1]);
    buckets.push({
      label: `${Math.round(edges[edgeIndex] * 100)}-${Math.min(100, Math.round(edges[edgeIndex + 1] * 100))}%`,
      picks: inBucket.length,
      predicted: inBucket.length > 0 ? inBucket.reduce((runningTotal, pick) => runningTotal + pick.modelProbability!, 0) / inBucket.length : null,
      actual: inBucket.length > 0 ? inBucket.filter((pick) => pick.result!.status === "win").length / inBucket.length : null,
    });
  }
  return buckets;
}

export function groupBy<KeyType extends string>(picks: TrackedPick[], keyOf: (pick: TrackedPick) => KeyType): Map<KeyType, TrackedPick[]> {
  const grouped = new Map<KeyType, TrackedPick[]>();
  for (const pick of picks) grouped.set(keyOf(pick), [...(grouped.get(keyOf(pick)) ?? []), pick]);
  return grouped;
}

export function evBucket(evPercent: number | null): string {
  if (evPercent === null) return "no price";
  if (evPercent < 3) return "< 3%";
  if (evPercent < 5) return "3-5%";
  if (evPercent < 10) return "5-10%";
  return "10%+";
}
