import { describe, expect, it } from "vitest";
import { evaluateGameLines, homeCourtPoints, injuryWeight, projectGame, selectionProbability } from "@/lib/analytics/gameModel";
import { blendRating, type TeamRating } from "@/lib/analytics/aggregates/teamRatings";
import type { BdlBettingOdd } from "@/lib/bdl/types";

function rating(teamId: number, offense: number, defense: number, pace: number): TeamRating {
  return { teamId, current: null, previous: null, recent: null, blended: { offense, defense, pace }, currentWeight: 1 };
}

const league = { offense: 115, pace: 100 };
const noContext = { homeRest: undefined, awayRest: undefined, homeInjuries: [], awayInjuries: [] };

describe("projectGame", () => {
  it("two average teams: total is about two average scores, margin is home court", () => {
    const projection = projectGame(rating(1, 115, 115, 100), rating(2, 115, 115, 100), league, noContext);
    expect(projection.total).toBeCloseTo(230, 6);
    expect(projection.margin).toBeCloseTo(homeCourtPoints, 6);
    expect(projection.homeWinProbability).toBeGreaterThan(0.5);
  });
  it("two fast teams play faster than either", () => {
    const projection = projectGame(rating(1, 115, 115, 104), rating(2, 115, 115, 104), league, noContext);
    expect(projection.pace).toBeCloseTo(108.16, 2);
  });
  it("a back-to-back and a missing scorer move the margin toward the other side", () => {
    const base = projectGame(rating(1, 115, 115, 100), rating(2, 115, 115, 100), league, noContext);
    const tired = projectGame(rating(1, 115, 115, 100), rating(2, 115, 115, 100), league, {
      ...noContext,
      homeRest: { teamId: 1, previousGameDate: "2026-10-26", restDays: 0, backToBack: true },
      homeInjuries: [{ playerName: "A. Star", status: "Out", pointsLost: 4 }],
    });
    expect(tired.margin).toBeCloseTo(base.margin - 1.5 - 4, 6);
    expect(tired.total).toBeCloseTo(base.total - 0.5 - 4, 6);
  });
});

describe("selectionProbability", () => {
  const projection = { margin: 5, total: 228 };
  it("home -5 is a coin flip when the model says +5", () => {
    expect(selectionProbability(projection, "spread_home", -5)).toBeCloseTo(0.5, 6);
    expect(selectionProbability(projection, "spread_away", 5)).toBeCloseTo(0.5, 6);
  });
  it("totals and moneylines", () => {
    expect(selectionProbability(projection, "total_over", 228)).toBeCloseTo(0.5, 6);
    expect(selectionProbability(projection, "total_under", 220)!).toBeLessThan(0.5);
    expect(selectionProbability(projection, "moneyline_home", null)! + selectionProbability(projection, "moneyline_away", null)!).toBeCloseTo(1, 9);
  });
});

describe("evaluateGameLines", () => {
  const odd = (vendor: string, spreadHome: string, homeOdds: number): BdlBettingOdd => ({ id: 1, game_id: 9, vendor, spread_home_value: spreadHome, spread_home_odds: homeOdds, spread_away_value: String(-Number(spreadHome)), spread_away_odds: -110, moneyline_home_odds: -150, moneyline_away_odds: 130, total_value: "228", total_over_odds: -110, total_under_odds: -110 });
  const projection = projectGame(rating(1, 116, 114, 100), rating(2, 114, 116, 100), league, noContext); // about home by 6
  it("picks the book with the best EV for each side and flags it", () => {
    const edges = evaluateGameLines(projection, [odd("fanduel", "-4.5", -110), odd("draftkings", "-4.5", +100)], "HOM", "AWY", 3);
    const homeSpread = edges.find((edge) => edge.selection === "spread_home")!;
    expect(homeSpread.vendor).toBe("draftkings");
    expect(homeSpread.flagged).toBe(true);
  });
  it("never flags a line far from the market", () => {
    const edges = evaluateGameLines(projection, [odd("fanduel", "+6.5", -110)], "HOM", "AWY", 3);
    expect(edges.find((edge) => edge.selection === "spread_home")!.tooFar).toBe(true);
    expect(edges.find((edge) => edge.selection === "spread_home")!.flagged).toBe(false);
  });
});

describe("helpers", () => {
  it("weights injury statuses", () => {
    expect(injuryWeight("Out")).toBe(1);
    expect(injuryWeight("Questionable")).toBe(0.4);
    expect(injuryWeight("Available")).toBe(0);
  });
  it("leans on last season until this season has games", () => {
    const sample = (offense: number, games: number) => ({ games, offense, defense: offense, pace: 100, pointsFor: 0, pointsAgainst: 0 });
    expect(blendRating(sample(120, 0), sample(110, 82), null, league).blended.offense).toBeCloseTo(110, 6);
    expect(blendRating(sample(120, 8), sample(110, 82), null, league).blended.offense).toBeCloseTo(115, 6);
  });
});
