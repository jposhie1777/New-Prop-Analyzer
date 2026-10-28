import { describe, expect, it } from "vitest";
import { calibrateRating, learnThreeQuarterCalibration, type ThreeQuarterSample } from "@/lib/analytics/threeQuarterLearning";
import { hundredRate, rateThreeQuarterChance, selectThreeQuarterRecommendations, type ThreeQuarterSeasonProfile } from "@/lib/analytics/aggregates/threeQuarters";

function sample(index: number, rating: number, hit: boolean, gameDate = "2026-10-22"): ThreeQuarterSample {
  return { sampleKey: `${index}`, gameId: index, teamId: 1, gameDate, season: 2026, rating, lineChance: rating, hit };
}

describe("learnThreeQuarterCalibration", () => {
  it("trusts the rating as is with no games", () => {
    const calibration = learnThreeQuarterCalibration([]);
    expect(calibrateRating(0.3, calibration)).toBeCloseTo(0.3, 6);
  });
  it("pulls overconfident ratings down once enough games disagree", () => {
    const samples = Array.from({ length: 800 }, (_, index) => sample(index, 0.3, index % 10 === 0)); // rated 30%, hit 10%
    const calibration = learnThreeQuarterCalibration(samples);
    expect(calibrateRating(0.3, calibration)).toBeLessThan(0.16);
    expect(calibration.hitRate).toBeCloseTo(0.1, 6);
  });
  it("a handful of games barely moves it", () => {
    const samples = Array.from({ length: 20 }, (_, index) => sample(index, 0.3, false));
    expect(calibrateRating(0.3, learnThreeQuarterCalibration(samples))).toBeGreaterThan(0.24);
  });
  it("never learns from the day being predicted", () => {
    expect(learnThreeQuarterCalibration([sample(1, 0.3, true, "2026-10-25")], "2026-10-25").sampleCount).toBe(0);
  });
});

describe("100-in-3 rating", () => {
  const profile = (hits: number, games: number, seasonHits: number, seasonGames: number) =>
    ({ scoredHundred: { L20: hits, SEASON: seasonHits }, scored: { L20: { games }, SEASON: { games: seasonGames } }, allowedHundred: { L20: hits, SEASON: seasonHits }, allowed: { L20: { games }, SEASON: { games: seasonGames } } }) as unknown as ThreeQuarterSeasonProfile;
  it("a 1-for-4 start leans on last season", () => {
    const rate = hundredRate(profile(1, 4, 1, 4), profile(0, 20, 16, 82), "scored", 0.13);
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.25);
  });
  it("blends 60% line chance with 20% each of team and opponent history", () => {
    expect(rateThreeQuarterChance(0.3, 0.2, 0.1)).toBeCloseTo(0.24, 9);
  });
  it("recommends the best few above the minimum", () => {
    const rows = [0.31, 0.12, 0.26, 0.22, 0.27, 0.19].map((rating, index) => ({ rating, index }));
    const chosen = [...selectThreeQuarterRecommendations(rows, 0.2, 3)].map((row) => row.rating);
    expect(chosen).toEqual([0.31, 0.27, 0.26]);
  });
});
