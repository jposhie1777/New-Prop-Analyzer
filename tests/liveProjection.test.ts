import { describe, expect, it } from "vitest";
import { clockLabel, foulTroubleFactor, normalizeShares, parseGameClock, projectLiveStat, restOfGameAverage } from "@/lib/analytics/liveProjection";

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
    expect(halfway.paceWeight).toBeCloseTo(0.1125, 6);
    expect(halfway.projection).toBeCloseTo(24, 6); // on pace and at the prior, so both agree
    const hot = projectLiveStat(20, flatPrior, parseGameClock("Halftime", "Half", 2), 1, 4);
    expect(hot.projection).toBeGreaterThan(20 + 12.5);
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

import { buildLivePropRows } from "@/lib/analytics/liveSuggestions";
import { bdlTeam } from "@/lib/nba/teams";
import type { BdlBoxScore, BdlPlayerProp } from "@/lib/bdl/types";
import type { QuarterProfile } from "@/lib/analytics/aggregates/playerAggregates";

describe("rest-of-game average on live rows", () => {
  it("sums the player's Q3 and Q4 averages at halftime", () => {
    const boxPlayer = { min: "18:00", pts: 12, reb: 3, ast: 2, pf: 1, fg3m: 1, stl: 0, blk: 0, player: { id: 77, first_name: "Test", last_name: "Player", position: "G" } };
    const boxScore = { date: "2026-10-25", status: "Halftime", time: "Half", period: 2, home_team_score: 50, visitor_team_score: 48, home_team: { team: bdlTeam(2), players: [boxPlayer] }, visitor_team: { team: bdlTeam(20), players: [] } } as unknown as BdlBoxScore;
    const props = [{ id: 1, game_id: 9, player_id: 77, vendor: "fanduel", prop_type: "points", line_value: "24.5", market: { type: "over_under", over_odds: -110, under_odds: -110 } }] as BdlPlayerProp[];
    const quarterStat = (points: number) => ({ pts: { average: points, variance: 4 } }) as unknown as QuarterProfile["quarters"][1];
    const profile = { playerId: 77, games: 10, quarters: { 1: quarterStat(6), 2: quarterStat(5), 3: quarterStat(6.5), 4: quarterStat(4.5) } } as QuarterProfile;
    const { rows, clock } = buildLivePropRows(boxScore, props, [], new Map([[77, profile]]), 3);
    expect(clock.isHalftime).toBe(true);
    expect(rows[0].restOfGame?.value).toBeCloseTo(11, 9);
    expect(rows[0].restOfGame?.label).toBe("2H");
    expect(rows[0].sampleGames).toBe(10);
  });
});

describe("restOfGameAverage", () => {
  const quarters: [number, number, number, number] = [6, 5, 6.5, 4.5];
  it("covers Q2 to Q4 at the end of the first", () => {
    expect(restOfGameAverage(quarters, { period: 1, secondsLeftInPeriod: 0, isHalftime: false, isFinished: false })).toEqual({ value: 16, label: "Q2–4" });
  });
  it("adds the unplayed part of the current quarter", () => {
    const result = restOfGameAverage(quarters, { period: 1, secondsLeftInPeriod: 360, isHalftime: false, isFinished: false });
    expect(result?.value).toBeCloseTo(19, 9);
    expect(result?.label).toBe("Q2–4");
  });
  it("names the current quarter early in it", () => {
    expect(restOfGameAverage(quarters, { period: 3, secondsLeftInPeriod: 720, isHalftime: false, isFinished: false })?.label).toBe("2H");
  });
  it("returns nothing in overtime or after the final", () => {
    expect(restOfGameAverage(quarters, { period: 5, secondsLeftInPeriod: 200, isHalftime: false, isFinished: false })).toBeNull();
    expect(restOfGameAverage(quarters, { period: 4, secondsLeftInPeriod: 0, isHalftime: false, isFinished: false })).toBeNull();
  });
});
