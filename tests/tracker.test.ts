import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calibrationBuckets, gradePick, profitUnits, summarizeRecord, type TrackedPick } from "@/lib/tracking/tracker";
import { gradePendingPicks } from "@/lib/tracking/grader";
import { buildMockAnalytics, type MockAnalyticsFixture } from "./helpers/mockAnalytics";
import { addDays, todayEastern } from "@/lib/dates";

function trackedPick(overrides: Partial<TrackedPick>): TrackedPick {
  return {
    trackId: Math.random().toString(36), createdAt: "2026-01-01T00:00:00Z", source: "halftime", kind: "prop", gameId: 1, gameDate: "2026-01-01", label: "test",
    side: "over", lineValue: 20.5, americanOdds: -110, vendor: "fanduel", modelProbability: 0.6, evPercent: 5, playerId: 1, teamId: null, propType: "points",
    metric: "pts", scope: "FG", result: null, ...overrides,
  };
}

describe("grading rules", () => {
  it("grades overs, unders, pushes and DNPs", () => {
    expect(gradePick({ kind: "prop", side: "over", lineValue: 20.5 }, { actual: 21 })).toBe("win");
    expect(gradePick({ kind: "prop", side: "under", lineValue: 20.5 }, { actual: 21 })).toBe("loss");
    expect(gradePick({ kind: "prop", side: "over", lineValue: 20 }, { actual: 20 })).toBe("push");
    expect(gradePick({ kind: "prop", side: "over", lineValue: 20.5 }, { actual: null })).toBe("void");
  });

  it("grades spreads and moneylines from the home margin", () => {
    expect(gradePick({ kind: "spread", side: "home", lineValue: -4.5 }, { actual: 5 })).toBe("win");
    expect(gradePick({ kind: "spread", side: "away", lineValue: 4.5 }, { actual: 5 })).toBe("loss");
    expect(gradePick({ kind: "spread", side: "away", lineValue: 5 }, { actual: 5 })).toBe("push");
    expect(gradePick({ kind: "moneyline", side: "away", lineValue: null }, { actual: -3 })).toBe("win");
  });

  it("computes units, ROI, Brier and calibration", () => {
    expect(profitUnits("win", 150)).toBe(1.5);
    expect(profitUnits("win", -200)).toBe(0.5);
    expect(profitUnits("loss", -110)).toBe(-1);
    const picks = [
      trackedPick({ americanOdds: 100, modelProbability: 0.6, result: { status: "win", actual: 25, gradedAt: "" } }),
      trackedPick({ americanOdds: 100, modelProbability: 0.6, result: { status: "loss", actual: 10, gradedAt: "" } }),
      trackedPick({ result: null }),
    ];
    const summary = summarizeRecord(picks);
    expect(summary).toMatchObject({ wins: 1, losses: 1, pending: 1, unitsProfit: 0, roiPercent: 0 });
    expect(summary.brierScore).toBeCloseTo((0.4 ** 2 + 0.6 ** 2) / 2, 9);
    expect(calibrationBuckets(picks).find((bucket) => bucket.label === "60-70%")).toMatchObject({ picks: 2, actual: 0.5 });
  });
});

describe("grading against DuckDB", () => {
  let fixture: MockAnalyticsFixture;
  const yesterday = addDays(todayEastern(), -1);
  beforeAll(async () => {
    fixture = await buildMockAnalytics([], [yesterday]);
  }, 60_000);
  afterAll(() => fixture?.engine.close());

  it("grades a prop, a total and a 100-in-3 pick from final data and leaves today's picks pending", async () => {
    const [statRow] = await fixture.engine.query<{ game_id: number; player_id: number; pts: number }>(`SELECT game_id, player_id, pts FROM player_game_stats WHERE minutes > 20 LIMIT 1`);
    const [gameRow] = await fixture.engine.query<{ home_score: number; visitor_score: number; home_team_id: number }>(`SELECT * FROM games WHERE game_id = ${statRow.game_id}`);
    const picks = [
      trackedPick({ trackId: "prop", gameId: statRow.game_id, gameDate: yesterday, playerId: statRow.player_id, lineValue: statRow.pts - 0.5 }),
      trackedPick({ trackId: "total", kind: "total", side: "under", gameId: statRow.game_id, gameDate: yesterday, lineValue: gameRow.home_score + gameRow.visitor_score + 0.5, playerId: null }),
      trackedPick({ trackId: "t3", kind: "team_three_quarters", gameId: statRow.game_id, gameDate: yesterday, teamId: gameRow.home_team_id, lineValue: 99.5, playerId: null, scope: "T3" }),
      trackedPick({ trackId: "today", gameId: statRow.game_id, gameDate: todayEastern(), playerId: statRow.player_id }),
    ];
    const graded = await gradePendingPicks(fixture.engine, picks, todayEastern());
    const byId = new Map(graded.map((pick) => [pick.trackId, pick]));
    expect(byId.get("prop")?.result).toMatchObject({ status: "win", actual: statRow.pts });
    expect(byId.get("total")?.result?.status).toBe("win");
    expect(["win", "loss"]).toContain(byId.get("t3")?.result?.status);
    expect(byId.has("today")).toBe(false);
  });
});
