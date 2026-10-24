import { describe, expect, it } from "vitest";
import {
  americanToDecimal,
  americanToImpliedProbability,
  decimalToAmerican,
  expectedValuePercent,
  formatAmerican,
  kellyFraction,
  noVigTwoWay,
  parlayAmericanOdds,
  parlayDecimalOdds,
  parlayProbability,
  probabilityToAmerican,
  removeVig,
} from "@/lib/math/odds";

describe("odds conversions", () => {
  it("converts American odds to decimal", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 6);
    expect(americanToDecimal(100)).toBe(2);
  });

  it("round-trips decimal and American odds", () => {
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(americanToDecimal(-200))).toBe(-200);
  });

  it("computes implied probability", () => {
    expect(americanToImpliedProbability(-110)).toBeCloseTo(0.5238, 4);
    expect(americanToImpliedProbability(200)).toBeCloseTo(1 / 3, 6);
    expect(probabilityToAmerican(0.5)).toBe(100);
  });

  it("rejects zero odds", () => {
    expect(() => americanToDecimal(0)).toThrow();
  });
});

describe("vig removal", () => {
  it("splits a symmetric market evenly", () => {
    const result = removeVig([-110, -110]);
    expect(result.fairProbabilities[0]).toBeCloseTo(0.5, 6);
    expect(result.vigPercent).toBeCloseTo(4.76, 2);
  });

  it("handles a lopsided market", () => {
    const fairFavorite = noVigTwoWay(-200, 170);
    expect(fairFavorite).toBeCloseTo(0.6429, 3);
    expect(fairFavorite + noVigTwoWay(170, -200)).toBeCloseTo(1, 9);
  });
});

describe("expected value and Kelly", () => {
  it("computes EV percent", () => {
    expect(expectedValuePercent(0.55, -110)).toBeCloseTo(5, 0);
    expect(expectedValuePercent(0.5, 100)).toBeCloseTo(0, 9);
  });

  it("computes quarter Kelly and never goes negative", () => {
    expect(kellyFraction(0.55, 100, 0.25)).toBeCloseTo(0.025, 6);
    expect(kellyFraction(0.4, -110)).toBe(0);
  });
});

describe("parlays", () => {
  it("multiplies decimal odds", () => {
    expect(parlayDecimalOdds([-110, -110])).toBeCloseTo(3.6446, 3);
    expect(parlayAmericanOdds([-110, -110])).toBe(264);
    expect(parlayDecimalOdds([])).toBe(1);
  });

  it("multiplies independent probabilities", () => {
    expect(parlayProbability([0.5, 0.5, 0.5])).toBeCloseTo(0.125, 9);
  });

  it("formats American odds", () => {
    expect(formatAmerican(120)).toBe("+120");
    expect(formatAmerican(-115)).toBe("-115");
    expect(formatAmerican(null)).toBe("-");
  });
});
