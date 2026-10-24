import { describe, expect, it } from "vitest";
import { clockLabel, foulTroubleFactor, normalizeShares, parseGameClock, projectLiveStat } from "@/lib/analytics/liveProjection";

const flatPrior = { fullGameMean: 24, quarterShares: { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 }, dispersion: 2, source: "pregame line" } as const;

describe("game clock", () => {
  it("parses the live feed's clock formats", () => {
    expect(parseGameClock("3rd Qtr", "Q3 11:12", 3)).toMatchObject({ period: 3, secondsLeftInPeriod: 672, isHalftime: false });
    expect(parseGameClock("2nd Qtr", "5:42", 2).secondsLeftInPeriod).toBe(342);
    expect(parseGameClock("Halftime", "Half", 2).isHalftime).toBe(true);
    expect(parseGameClock("Final", "Final", 4).isFinished).toBe(true);
    expect(parseGameClock("4th Qtr", "0:31.4", 4).secondsLeftInPeriod).toBe(31);
  });

  it("does not repeat the quarter in labels", () => {
    expect(clockLabel("3rd Qtr", "Q3 11:12")).toBe("Q3 11:12");
    expect(clockLabel("2nd Qtr", "5:42")).toBe("2nd Qtr 5:42");
    expect(clockLabel("Halftime", "Half")).toBe("Halftime");
  });
});

describe("live projection", () => {
  it("adds the pregame expectation for the time left, blended with tonight's pace", () => {
    const halfway = projectLiveStat(12, flatPrior, parseGameClock("Halftime", "Half", 2), 1, 4);
    expect(halfway.remainingShare).toBeCloseTo(0.5, 6);
    expect(halfway.paceWeight).toBeCloseTo(0.3, 6);
    expect(halfway.projection).toBeCloseTo(24, 6); // on pace and at the prior, so both agree
    const hot = projectLiveStat(20, flatPrior, parseGameClock("Halftime", "Half", 2), 1, 4);
    expect(hot.projection).toBeGreaterThan(20 + 12);
    expect(hot.projection).toBeLessThan(20 + 20);
    expect(projectLiveStat(30, flatPrior, parseGameClock("Final", "Final", 4), 0, 0).projection).toBe(30);
  });

  it("trims minutes for foul trouble and late blowouts", () => {
    expect(foulTroubleFactor(2, parseGameClock("1st Qtr", "4:00", 1)).factor).toBe(0.8);
    expect(foulTroubleFactor(3, parseGameClock("3rd Qtr", "4:00", 3)).factor).toBe(1);
    const blowout = projectLiveStat(0, flatPrior, parseGameClock("3rd Qtr", "12:00", 3), 0, 25);
    expect(blowout.minutesFactor).toBeCloseTo(0.85, 6);
    expect(projectLiveStat(0, flatPrior, parseGameClock("1st Qtr", "12:00", 1), 0, 25).minutesFactor).toBe(1);
  });

  it("shrinks noisy quarter splits toward even", () => {
    const shares = normalizeShares([10, 0, 0, 0]);
    expect(shares[1]).toBeCloseTo(0.775, 6);
    expect(shares[2] + shares[3] + shares[4] + shares[1]).toBeCloseTo(1, 9);
    expect(normalizeShares([0, 0, 0, 0])[3]).toBe(0.25);
  });
});

import { isHalftime } from "@/lib/data/flatten";

describe("halftime detection", () => {
  it("catches the different ways the feed marks halftime", () => {
    expect(isHalftime({ status: "Halftime", time: "Half", period: 2 })).toBe(true);
    expect(isHalftime({ status: "2nd Qtr", time: "Q2 0:00", period: 2 })).toBe(true);
    expect(isHalftime({ status: "2nd Qtr", time: "Q2 0:31", period: 2 })).toBe(false);
    expect(isHalftime({ status: "3rd Qtr", time: "Q3 11:12", period: 3 })).toBe(false);
  });
});

import { settleCashedOver } from "@/lib/analytics/liveSuggestions";
import { evaluateProp } from "@/lib/analytics/halftime";

describe("cashed overs", () => {
  it("treats an over that already hit as certain", () => {
    const settled = settleCashedOver(evaluateProp(1.6, 0.7, 0.5, 111, -140), 1, 0.5, 111, -140);
    expect(settled.overProbability).toBe(1);
    expect(settled.underProbability).toBe(0);
    expect(settled.bestEvPercent).toBeCloseTo(111, 6);
    const open = evaluateProp(4, 1.5, 5.5, -110, -110);
    expect(settleCashedOver(open, 3, 5.5, -110, -110)).toBe(open);
  });
});
