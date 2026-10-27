import { describe, expect, it } from "vitest";
import { dailyRecords, inRecordWindow, projectionAccuracy, strengthsAndWeaknesses, tagRecords } from "@/lib/tracking/modelRecord";
import { modelTags } from "@/lib/client/lineModel";
import type { TrackedPick } from "@/lib/tracking/tracker";
import type { LineEdge, GameProjection } from "@/lib/analytics/gameModel";

let counter = 0;
function modelPick(kind: "spread" | "total" | "moneyline", gameDate: string, status: "win" | "loss" | null, tags: string[], extra: Partial<TrackedPick> = {}): TrackedPick {
  counter += 1;
  return { trackId: `model-${counter}-${kind}`, createdAt: "", source: "model", kind, gameId: counter, gameDate, label: "", side: "home", lineValue: -3, americanOdds: -110, vendor: "fanduel", modelProbability: 0.55, evPercent: 5, playerId: null, teamId: null, propType: null, metric: null, scope: null, result: status ? { status, actual: 5, gradedAt: "" } : null, tags, ...extra };
}

describe("record windows", () => {
  it("season starts in October; recent windows exclude today", () => {
    const pick = modelPick("spread", "2026-10-20", "win", []);
    expect(inRecordWindow(pick, "season", "2026-10-27", 2026)).toBe(true);
    expect(inRecordWindow(pick, "last7", "2026-10-27", 2026)).toBe(true);
    expect(inRecordWindow(modelPick("spread", "2026-10-19", "win", []), "last7", "2026-10-27", 2026)).toBe(false);
    expect(inRecordWindow(modelPick("spread", "2026-09-30", "win", []), "season", "2026-10-27", 2026)).toBe(false);
  });
});

describe("projectionAccuracy", () => {
  it("compares the model's miss with the market's", () => {
    const picks = [modelPick("spread", "2026-10-25", "win", [], { projectedValue: 4, marketValue: -6, result: { status: "win", actual: 5, gradedAt: "" } })];
    const accuracy = projectionAccuracy(picks, "spread");
    expect(accuracy.modelError).toBe(1);
    expect(accuracy.marketError).toBe(1); // home -6 predicts +6, the game ended +5
  });
});

describe("strengths and weaknesses", () => {
  it("needs 10 decided picks and a clear ROI either way", () => {
    const picks = [
      ...Array.from({ length: 8 }, () => modelPick("total", "2026-10-25", "win", ["Under"])),
      ...Array.from({ length: 3 }, () => modelPick("total", "2026-10-25", "loss", ["Under"])),
      ...Array.from({ length: 3 }, () => modelPick("total", "2026-10-25", "win", ["Over"])),
      ...Array.from({ length: 9 }, () => modelPick("total", "2026-10-25", "loss", ["Over"])),
    ];
    const verdicts = strengthsAndWeaknesses(picks);
    expect(verdicts.strengths.map((verdict) => verdict.tag)).toContain("Under");
    expect(verdicts.weaknesses.map((verdict) => verdict.tag)).toContain("Over");
    expect(tagRecords(picks)[0].tag).toBe("Under");
  });
});

describe("dailyRecords", () => {
  it("splits each day by market, newest first", () => {
    const days = dailyRecords([modelPick("spread", "2026-10-24", "win", []), modelPick("total", "2026-10-25", "loss", []), modelPick("total", "2026-10-25", "win", [])]);
    expect(days.map((day) => day.date)).toEqual(["2026-10-25", "2026-10-24"]);
    expect(days[0].byMarket.total.wins).toBe(1);
    expect(days[0].byMarket.total.losses).toBe(1);
    expect(days[1].byMarket.spread.wins).toBe(1);
  });
});

describe("modelTags", () => {
  const projection = { pace: 104, homePoints: 118, awayPoints: 110, margin: 8, total: 228, homeWinProbability: 0.74, factors: [{ label: "Home missing A. Star", marginEffect: -3, totalEffect: -3 }] } as GameProjection;
  const edge = (overrides: Partial<LineEdge>): LineEdge => ({ market: "spread", selection: "spread_home", sideLabel: "", line: -4.5, americanOdds: -110, vendor: "fanduel", modelProbability: 0.6, marketProbability: 0.5, evPercent: 6, fairText: "", marketText: "", marketValue: -4.5, tooFar: false, flagged: true, ...overrides });
  it("describes the side, the gap to the market and the context", () => {
    expect(modelTags(edge({}), projection, 99, { backToBack: true, backtest: false })).toEqual(["Home side", "Favorite", "Model 3+ pts off", "Flagged edge", "Back-to-back game", "Injury-adjusted"]);
    expect(modelTags(edge({ market: "total", selection: "total_under", line: 230, marketValue: 230, flagged: false }), projection, 99, { backToBack: false, backtest: true })).toEqual(["Under", "Fast projected pace", "Model within 3 pts", "Not flagged", "Injury-adjusted", "Backtest"]);
  });
});
