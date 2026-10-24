import { describe, expect, it } from "vitest";
import { hitRate, mean, normalCdf, probabilityAtLeast, probabilityOver, probabilityUnder, sampleStandardDeviation } from "@/lib/math/probability";

describe("normal approximation", () => {
  it("matches known CDF values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCdf(110, 100, 10)).toBeCloseTo(0.8413, 3);
  });

  it("handles zero spread", () => {
    expect(normalCdf(5, 5, 0)).toBe(1);
    expect(normalCdf(4, 5, 0)).toBe(0);
  });

  it("applies continuity correction", () => {
    expect(probabilityAtLeast(100, 100, 8)).toBeCloseTo(normalCdf(0.5 / 8), 6);
    expect(probabilityOver(24.5, 24.5, 5)).toBeCloseTo(0.5, 6);
    expect(probabilityOver(25, 25, 5)).toBeCloseTo(1 - normalCdf(25.5, 25, 5), 6);
    expect(probabilityUnder(24.5, 24.5, 5)).toBeCloseTo(0.5, 6);
  });
});

describe("descriptive stats", () => {
  it("computes mean, sample sd and hit rate", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sampleStandardDeviation([1])).toBeNull();
    expect(hitRate([10, 20, 30], 15)).toBeCloseTo(2 / 3, 9);
  });
});
