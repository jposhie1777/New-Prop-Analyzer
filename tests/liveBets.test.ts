import { describe, expect, it } from "vitest";
import { bdlTeam } from "@/lib/nba/teams";
import type { BdlBoxScore } from "@/lib/bdl/types";
import type { LivePropRow } from "@/lib/analytics/liveSuggestions";
import type { GameClock } from "@/lib/analytics/liveProjection";
import { bestBetTag, clockLabelFor, combineLivePicks, gradeLiveBet, pickFromRow, summarizeLiveBets, type LiveBetPick } from "@/lib/live/liveBets";

function boxScoreWith(points: number, minutes: string): BdlBoxScore {
  const boxPlayer = { min: minutes, pts: points, reb: 3, ast: 2, pf: 1, fg3m: 1, stl: 0, blk: 0, player: { id: 77, first_name: "Test", last_name: "Player", position: "G" } };
  return { date: "2026-10-25", status: "3rd Qtr", time: "6:00", period: 3, home_team_score: 70, visitor_team_score: 60, home_team: { team: bdlTeam(2), players: [boxPlayer] }, visitor_team: { team: bdlTeam(20), players: [] } } as unknown as BdlBoxScore;
}

function rowWith(overProbability: number, overOdds: number, extra: Partial<LivePropRow> = {}): LivePropRow {
  return {
    playerId: 77,
    playerName: "Test Player",
    teamId: bdlTeam(2).id,
    teamAbbreviation: bdlTeam(2).abbreviation,
    propType: "points",
    label: "Points",
    lineValue: 20.5,
    currentValue: 14,
    personalFouls: 1,
    shooting: null,
    inactiveNote: null,
    flagged: true,
    bestOverOdds: overOdds,
    bestOverVendor: "fanduel",
    bestUnderOdds: -130,
    bestUnderVendor: "draftkings",
    projection: { projection: 23 },
    evaluation: { bestSide: "over", overProbability, underProbability: 1 - overProbability },
    ...extra,
  } as unknown as LivePropRow;
}

const thirdQuarter: GameClock = { period: 3, secondsLeftInPeriod: 360, isHalftime: false, isFinished: false };

describe("pickFromRow", () => {
  it("records a flagged edge with the score margin and tags", () => {
    const pick = pickFromRow(rowWith(0.6, 100), boxScoreWith(14, "24:00"), 9, "2026-10-25", thirdQuarter, "2026-10-25T01:00:00Z");
    expect(pick?.pickId).toBe("9-77-points");
    expect(pick?.scoreMargin).toBe(10);
    expect(pick?.clockLabel).toBe("Q3 6:00");
    expect(pick?.evPercent).toBeCloseTo(20, 6);
    expect(pick?.tags).toContain(bestBetTag);
    expect(pick?.tags).toContain("Found in Q3");
  });
  it("skips unflagged rows, inactive players and edges too small or too big to trust", () => {
    const boxScore = boxScoreWith(14, "24:00");
    expect(pickFromRow(rowWith(0.6, 100, { flagged: false }), boxScore, 9, "2026-10-25", thirdQuarter, "now")).toBeNull();
    expect(pickFromRow(rowWith(0.6, 100, { inactiveNote: "On the bench" } as Partial<LivePropRow>), boxScore, 9, "2026-10-25", thirdQuarter, "now")).toBeNull();
    expect(pickFromRow(rowWith(0.51, 100), boxScore, 9, "2026-10-25", thirdQuarter, "now")).toBeNull();
    expect(pickFromRow(rowWith(0.7, 100), boxScore, 9, "2026-10-25", thirdQuarter, "now")).toBeNull();
  });
  it("only calls it a best bet with enough edge and chance", () => {
    const pick = pickFromRow(rowWith(0.54, 100), boxScoreWith(14, "24:00"), 9, "2026-10-25", thirdQuarter, "now");
    expect(pick).not.toBeNull();
    expect(pick?.tags).not.toContain(bestBetTag);
  });
});

describe("gradeLiveBet and the record", () => {
  const pick = pickFromRow(rowWith(0.6, 100), boxScoreWith(14, "24:00"), 9, "2026-10-25", thirdQuarter, "now") as LiveBetPick;
  it("grades from the final box score", () => {
    expect(gradeLiveBet(pick, boxScoreWith(22, "36:00"), "later").result?.status).toBe("win");
    expect(gradeLiveBet(pick, boxScoreWith(18, "36:00"), "later").result?.status).toBe("loss");
    expect(gradeLiveBet(pick, boxScoreWith(0, "0:00"), "later").result?.status).toBe("void");
  });
  it("adds up units at the recorded price", () => {
    const win = gradeLiveBet(pick, boxScoreWith(22, "36:00"), "later");
    const loss = gradeLiveBet({ ...pick, pickId: "other" }, boxScoreWith(18, "36:00"), "later");
    const summary = summarizeLiveBets([win, loss, { ...pick, pickId: "open" }]);
    expect(summary).toMatchObject({ wins: 1, losses: 1, pending: 1, winRate: 0.5, units: 0 });
  });
  it("prefers the graded copy when merging tonight with the history", () => {
    const graded = gradeLiveBet(pick, boxScoreWith(22, "36:00"), "later");
    expect(combineLivePicks([graded], [pick])[0].result?.status).toBe("win");
  });
});

describe("clockLabelFor", () => {
  it("names halftime and overtime", () => {
    expect(clockLabelFor({ period: 2, secondsLeftInPeriod: 0, isHalftime: true, isFinished: false })).toBe("Halftime");
    expect(clockLabelFor({ period: 5, secondsLeftInPeriod: 125, isHalftime: false, isFinished: false })).toBe("OT1 2:05");
  });
});
