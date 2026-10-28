import { describe, expect, it } from "vitest";
import { bdlTeam } from "@/lib/nba/teams";
import type { BdlBoxScore } from "@/lib/bdl/types";
import { betState, legProgress } from "@/lib/tracking/betProgress";
import type { PlacedLeg } from "@/lib/client/placedBets";

function boxScore(status: string, homeScore: number, visitorScore: number, points: number): BdlBoxScore {
  const boxPlayer = { min: "30:00", pts: points, reb: 4, ast: 6, fg3m: 2, stl: 0, blk: 0, pf: 2, player: { id: 77, first_name: "Test", last_name: "Player" } };
  return { date: "2026-10-28", status, time: status === "Final" ? "Final" : "5:42", period: 3, home_team_score: homeScore, visitor_team_score: visitorScore, home_team: { team: bdlTeam(1), players: [boxPlayer] }, visitor_team: { team: bdlTeam(14), players: [] } } as unknown as BdlBoxScore;
}

const propLeg: PlacedLeg = { pickId: "p", kind: "prop", gameId: 5, gameDate: "2026-10-28", market: "prop", selectionKey: "over", label: "Test Player Over 20.5 Points", detail: "LAL @ ATL", propType: "points", playerId: 77, lineValue: 20.5, americanOdds: -110, vendor: "fanduel" };
const spreadLeg: PlacedLeg = { ...propLeg, pickId: "s", kind: "game", market: "spread", selectionKey: "spread_home", propType: null, playerId: null, lineValue: -4.5, label: "ATL -4.5" };

describe("bet progress", () => {
  it("shows a live over in progress and cashes it early", () => {
    expect(legProgress(propLeg, null, boxScore("3rd Qtr", 70, 60, 14), null)).toMatchObject({ state: "live", text: "14 of 20.5", onTrack: false });
    expect(legProgress(propLeg, null, boxScore("3rd Qtr", 70, 60, 22), null).state).toBe("win");
  });
  it("grades spreads from the score", () => {
    expect(legProgress(spreadLeg, null, boxScore("3rd Qtr", 70, 60, 0), null)).toMatchObject({ state: "live", onTrack: true });
    expect(legProgress(spreadLeg, null, boxScore("Final", 100, 97, 0), null).state).toBe("loss");
  });
  it("uses the final grade for older bets", () => {
    const tracked = { result: { status: "win", actual: 25, gradedAt: "x" } } as never;
    expect(legProgress(propLeg, null, null, tracked)).toMatchObject({ state: "win", text: "Finished with 25" });
  });
  it("settles a parlay", () => {
    expect(betState(["win", "loss", "live"])).toBe("loss");
    expect(betState(["win", "live"])).toBe("live");
    expect(betState(["win", "push"])).toBe("win");
    expect(betState(["upcoming", "upcoming"])).toBe("upcoming");
  });
});
