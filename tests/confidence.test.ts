import { describe, expect, it } from "vitest";
import { rateConfidence } from "@/lib/analytics/confidence";
import type { LineEdge } from "@/lib/analytics/gameModel";

const edge: LineEdge = { market: "spread", selection: "spread_home", sideLabel: "ATL -2.5", line: -2.5, americanOdds: -110, vendor: "fanduel", modelProbability: 0.58, marketProbability: 0.5, evPercent: 10.7, fairText: "ATL -5", marketText: "ATL -2.5", marketValue: -2.5, tooFar: false, flagged: true };

describe("confidence rating", () => {
  it("rates a strong, agreed, steamed play as high", () => {
    const rating = rateConfidence({ edge, otherModelEdge: { ...edge, evPercent: 6 }, openingMarketValue: -1.5, marketRecord: { decided: 60, roiPercent: 6 }, sampleGames: 12, injuryAdjusted: false });
    expect(rating.score % 5).toBe(0);
    expect(rating.level).toBe("very-high");
    expect(rating.score).toBeGreaterThanOrEqual(80);
    expect(rating.parts).toHaveLength(5);
  });
  it("drops when the models disagree, the line moved away and data is thin", () => {
    const rating = rateConfidence({ edge, otherModelEdge: { ...edge, evPercent: -5 }, openingMarketValue: -3.5, marketRecord: null, sampleGames: 2, injuryAdjusted: true });
    expect(rating.score).toBeLessThan(50);
  });
  it("gives no edge credit to a suspiciously big gap", () => {
    const rating = rateConfidence({ edge: { ...edge, tooFar: true }, otherModelEdge: null, openingMarketValue: null, marketRecord: null, sampleGames: 10, injuryAdjusted: false });
    expect(rating.parts[0].points).toBe(0);
  });
  it("reads totals movement by side", () => {
    const over: LineEdge = { ...edge, market: "total", selection: "total_over", marketValue: 230 };
    const toward = rateConfidence({ edge: over, otherModelEdge: null, openingMarketValue: 228, marketRecord: null, sampleGames: 10, injuryAdjusted: false });
    const away = rateConfidence({ edge: over, otherModelEdge: null, openingMarketValue: 232, marketRecord: null, sampleGames: 10, injuryAdjusted: false });
    expect(toward.parts[2].points).toBeGreaterThan(away.parts[2].points);
  });
});
