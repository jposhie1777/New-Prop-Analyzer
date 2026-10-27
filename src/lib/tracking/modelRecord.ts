import { summarizeRecord, type RecordSummary, type TrackedPick } from "./tracker";
import { addDays } from "@/lib/dates";

export const modelMarkets = ["spread", "total", "moneyline"] as const;
export type ModelMarket = (typeof modelMarkets)[number];
export const modelMarketLabels: Record<ModelMarket, string> = { spread: "Spreads", total: "Totals", moneyline: "Moneylines" };

export type RecordWindow = "season" | "last30" | "last7";
export const recordWindowLabels: Record<RecordWindow, string> = { season: "Season", last30: "Last 30 days", last7: "Last 7 days" };

export const minimumGradedForVerdict = 10; // fewer decided picks than this is noise

export function seasonStartDate(season: number): string {
  return `${season}-10-01`; // the NBA season tips off in October of its start year
}

export function inRecordWindow(pick: TrackedPick, recordWindow: RecordWindow, today: string, season: number): boolean {
  if (recordWindow === "season") return pick.gameDate >= seasonStartDate(season);
  return pick.gameDate >= addDays(today, recordWindow === "last30" ? -30 : -7) && pick.gameDate < today;
}

export interface ProjectionAccuracy {
  games: number;
  modelError: number | null; // average miss of the model's projection, in points
  marketError: number | null; // average miss of the consensus line it was compared against
}

export function projectionAccuracy(picks: TrackedPick[], market: ModelMarket): ProjectionAccuracy {
  const measured = picks.filter((pick) => pick.result?.actual !== null && pick.result?.actual !== undefined && pick.projectedValue !== null && pick.projectedValue !== undefined);
  if (measured.length === 0 || market === "moneyline") return { games: measured.length, modelError: null, marketError: null };
  const modelMisses = measured.map((pick) => Math.abs(pick.projectedValue! - pick.result!.actual!));
  const marketMisses = measured
    .filter((pick) => pick.marketValue !== null && pick.marketValue !== undefined)
    .map((pick) => Math.abs((market === "spread" ? -pick.marketValue! : pick.marketValue!) - pick.result!.actual!)); // a home spread of -5 predicts a home margin of +5
  const average = (values: number[]) => (values.length > 0 ? values.reduce((runningTotal, value) => runningTotal + value, 0) / values.length : null);
  return { games: measured.length, modelError: average(modelMisses), marketError: average(marketMisses) };
}

export interface TagRecord {
  tag: string;
  summary: RecordSummary;
}

export function tagRecords(picks: TrackedPick[]): TagRecord[] {
  const byTag = new Map<string, TrackedPick[]>();
  for (const pick of picks) for (const tag of pick.tags ?? []) byTag.set(tag, [...(byTag.get(tag) ?? []), pick]);
  return [...byTag.entries()].map(([tag, tagPicks]) => ({ tag, summary: summarizeRecord(tagPicks) })).sort((first, second) => (second.summary.roiPercent ?? -Infinity) - (first.summary.roiPercent ?? -Infinity));
}

export interface Verdict {
  market: ModelMarket;
  tag: string | null; // null = the whole market
  summary: RecordSummary;
}

export function strengthsAndWeaknesses(picks: TrackedPick[], roiCutoff = 5): { strengths: Verdict[]; weaknesses: Verdict[] } {
  const verdicts: Verdict[] = [];
  for (const market of modelMarkets) {
    const marketPicks = picks.filter((pick) => pick.kind === market);
    verdicts.push({ market, tag: null, summary: summarizeRecord(marketPicks) });
    for (const tagRecord of tagRecords(marketPicks)) verdicts.push({ market, tag: tagRecord.tag, summary: tagRecord.summary });
  }
  const decided = (verdict: Verdict) => verdict.summary.wins + verdict.summary.losses;
  const qualified = verdicts.filter((verdict) => decided(verdict) >= minimumGradedForVerdict && verdict.summary.roiPercent !== null);
  return {
    strengths: qualified.filter((verdict) => verdict.summary.roiPercent! >= roiCutoff).sort((first, second) => second.summary.roiPercent! - first.summary.roiPercent!).slice(0, 5),
    weaknesses: qualified.filter((verdict) => verdict.summary.roiPercent! <= -roiCutoff).sort((first, second) => first.summary.roiPercent! - second.summary.roiPercent!).slice(0, 5),
  };
}

export interface DailyRecord {
  date: string;
  byMarket: Record<ModelMarket, RecordSummary>;
  total: RecordSummary;
}

export function dailyRecords(picks: TrackedPick[], dayLimit = 14): DailyRecord[] {
  const dates = [...new Set(picks.map((pick) => pick.gameDate))].sort().reverse().slice(0, dayLimit);
  return dates.map((date) => {
    const dayPicks = picks.filter((pick) => pick.gameDate === date);
    return {
      date,
      byMarket: Object.fromEntries(modelMarkets.map((market) => [market, summarizeRecord(dayPicks.filter((pick) => pick.kind === market))])) as Record<ModelMarket, RecordSummary>,
      total: summarizeRecord(dayPicks),
    };
  });
}
