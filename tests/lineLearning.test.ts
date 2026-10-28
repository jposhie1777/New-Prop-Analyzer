import { describe, expect, it } from "vitest";
import { applyLearning, learnParameters, learningPriors, type LineSample } from "@/lib/analytics/lineLearning";
import { marginDeviation, totalDeviation } from "@/lib/analytics/gameModel";

function sample(index: number, values: Partial<LineSample>): LineSample {
  return { gameId: index, gameDate: `2026-10-${String(10 + (index % 20)).padStart(2, "0")}`, season: 2026, modelMargin: 0, modelTotal: 225, marketMargin: 0, marketTotal: 225, actualMargin: 0, actualTotal: 225, ...values };
}

function noise(index: number, size: number): number {
  return ((index * 7919) % 21) - 10 > 0 ? size : -size; // deterministic +/- swings
}

describe("learnParameters", () => {
  it("starts from the priors with no games", () => {
    const parameters = learnParameters([]);
    expect(parameters.marginTrust).toBeCloseTo(learningPriors.trust, 9);
    expect(parameters.totalBias).toBe(0);
    expect(parameters.marginDeviation).toBeCloseTo(marginDeviation, 9);
    expect(parameters.totalDeviation).toBeCloseTo(totalDeviation, 9);
  });

  it("trusts the model more when its disagreements keep coming true", () => {
    const samples = Array.from({ length: 600 }, (_, index) => {
      const disagreement = noise(index, 4);
      return sample(index, { modelMargin: disagreement, marketMargin: 0, actualMargin: disagreement + noise(index * 3, 1) });
    });
    expect(learnParameters(samples).marginTrust).toBeGreaterThan(0.75);
  });

  it("leans on the market when the model's disagreements are noise", () => {
    const samples = Array.from({ length: 600 }, (_, index) => sample(index, { modelMargin: index % 2 === 0 ? 4 : -4, marketMargin: 0, actualMargin: index % 4 < 2 ? 4 : -4 })); // the model's leans and the results are uncorrelated by construction
    expect(learnParameters(samples).marginTrust).toBeLessThan(learningPriors.trust);
  });

  it("removes a steady bias, shrunk for small samples", () => {
    const samples = Array.from({ length: 100 }, (_, index) => sample(index, { modelTotal: 220, actualTotal: 224 }));
    expect(learnParameters(samples).totalBias).toBeCloseTo((4 * 100) / (100 + learningPriors.biasPriorGames), 9);
  });

  it("never learns from the day being predicted or later", () => {
    const samples = [sample(1, { gameDate: "2026-10-20", modelTotal: 200, actualTotal: 240 }), sample(2, { gameDate: "2026-10-25", modelTotal: 200, actualTotal: 240 })];
    expect(learnParameters(samples, "2026-10-21").sampleCount).toBe(1);
    expect(learnParameters(samples, "2026-10-20").sampleCount).toBe(0);
  });
});

describe("applyLearning", () => {
  it("blends model and market by trust after the bias fix", () => {
    const parameters = { sampleCount: 300, marginBias: 1, totalBias: -2, marginTrust: 0.25, totalTrust: 0.5, marginDeviation: 13, totalDeviation: 18 };
    const learned = applyLearning({ margin: 7, total: 230 }, { margin: 3, total: 224 }, parameters);
    expect(learned.margin).toBeCloseTo(3 + 0.25 * (8 - 3), 9);
    expect(learned.total).toBeCloseTo(224 + 0.5 * (228 - 224), 9);
    expect(learned.marginDeviation).toBe(13);
  });
  it("uses the adjusted model when there is no market", () => {
    const learned = applyLearning({ margin: 7, total: 230 }, { margin: null, total: null }, { sampleCount: 0, marginBias: 0, totalBias: 0, marginTrust: 0.35, totalTrust: 0.35, marginDeviation: 12.5, totalDeviation: 17 });
    expect(learned.margin).toBe(7);
    expect(learned.homeWinProbability).toBeGreaterThan(0.5);
  });
});
