import { describe, expect, it } from "vitest";
import { evaluateProp, minutesFactorFor, projectHalftime } from "@/lib/analytics/halftime";
import { impliedTeamTotals, consensusLine, median, medianAmerican } from "@/lib/odds/consensus";
import type { BdlBettingOdd } from "@/lib/bdl/types";

describe("halftime projection", () => {
  it("adds the 2nd-half average to the 1st-half actual", () => {
    const result = projectHalftime({ firstHalfActual: 14, secondHalfAverage: 12, secondHalfDeviation: 5, secondHalfMinutesAverage: 17, personalFouls: 1, scoreMargin: 6 });
    expect(result.projection).toBe(26);
    expect(result.minutesFactor).toBe(1);
    expect(result.adjustments).toEqual([]);
  });

  it("trims minutes for foul trouble and blowouts", () => {
    expect(minutesFactorFor(4, 3).factor).toBeCloseTo(0.7, 9);
    expect(minutesFactorFor(3, 25).factor).toBeCloseTo(0.68, 9);
    const result = projectHalftime({ firstHalfActual: 10, secondHalfAverage: 10, secondHalfDeviation: 4, secondHalfMinutesAverage: 16, personalFouls: 4, scoreMargin: 22 });
    expect(result.projection).toBeCloseTo(15.6, 6);
    expect(result.adjustments).toHaveLength(2);
  });

  it("computes EV against the de-vigged market", () => {
    const evaluation = evaluateProp(28, 5, 24.5, -110, -110);
    expect(evaluation.noVigOver).toBeCloseTo(0.5, 6);
    expect(evaluation.overProbability).toBeGreaterThan(0.75);
    expect(evaluation.bestSide).toBe("over");
    expect(evaluation.bestEvPercent!).toBeGreaterThan(40);
    expect(evaluateProp(20, 5, 24.5, -110, null).noVigOver).toBeNull();
  });
});

describe("line consensus", () => {
  it("takes the median across books and implies team totals", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(medianAmerican([-110, 110])).toBe(100); // not 0, which is not a valid price
    expect(medianAmerican([-150, -130, -140])).toBe(-140);
    const odds = [
      { vendor: "fanduel", spread_home_value: "-5.5", total_value: "221.5", moneyline_home_odds: -220, moneyline_away_odds: 180 },
      { vendor: "draftkings", spread_home_value: "-4.5", total_value: "222.5", moneyline_home_odds: -200, moneyline_away_odds: 170 },
    ] as unknown as BdlBettingOdd[];
    const consensus = consensusLine(odds);
    expect(consensus.spreadHome).toBe(-5);
    expect(consensus.total).toBe(222);
    expect(impliedTeamTotals(-5, 222)).toEqual({ home: 113.5, away: 108.5 });
  });
});
