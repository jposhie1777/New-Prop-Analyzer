import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMockAnalytics, mockDates, type MockAnalyticsFixture } from "./helpers/mockAnalytics";
import { addDays, todayEastern } from "@/lib/dates";
import { playerHitRates, playerWindowAggregates, playerGameLog, searchPlayers, computeHitRates } from "@/lib/analytics/aggregates/playerAggregates";
import { restFromPreviousGame, teamRest, teamWindowAggregates } from "@/lib/analytics/aggregates/teamAggregates";
import { defenseVsPosition } from "@/lib/analytics/aggregates/defenseVsPosition";
import { usageShift } from "@/lib/analytics/aggregates/usageShift";
import { estimateThreeQuarterShare, projectThreeQuarters, threeQuarterProfiles } from "@/lib/analytics/aggregates/threeQuarters";
import { mockInjuries } from "@/lib/bdl/mock/mockWorld";

let fixture: MockAnalyticsFixture;
const yesterday = addDays(todayEastern(), -1);

beforeAll(async () => {
  fixture = await buildMockAnalytics(mockDates("2025-10-21", "2025-12-20"), mockDates("2026-10-20", yesterday));
}, 120_000);

afterAll(() => fixture?.engine.close());

async function busiestPlayer(): Promise<number> {
  const [busiest] = await fixture.engine.query<{ player_id: number }>(`SELECT player_id FROM player_game_stats WHERE season = 2025 AND minutes > 0 GROUP BY player_id ORDER BY COUNT(*) DESC, SUM(pts) DESC LIMIT 1`);
  return busiest.player_id;
}

describe("player aggregates", () => {
  it("window averages match a manual calculation", async () => {
    const playerId = await busiestPlayer();
    const table = await playerWindowAggregates(fixture.engine, playerId, [2025, 2026]);
    const lastFive = await fixture.engine.query<{ pts: number }>(`SELECT pts FROM player_game_stats WHERE player_id = ${playerId} AND season = 2025 AND minutes > 0 ORDER BY game_date DESC LIMIT 5`);
    const manualAverage = lastFive.reduce((runningTotal, statRow) => runningTotal + statRow.pts, 0) / 5;
    expect(table[2025].FG!.L5.pts.average).toBeCloseTo(manualAverage, 6);
    expect(table[2025].FG!.L5.pts.games).toBe(5);
    expect(table[2025].FG!.SEASON.pts.standardDeviation).toBeGreaterThan(0);
    expect(table[2025].H1!.SEASON.pts.average! + table[2025].H2!.SEASON.pts.average!).toBeCloseTo(table[2025].FG!.SEASON.pts.average!, 6);
    expect(table[2025].T3!.L10.pra.average!).toBeLessThan(table[2025].FG!.L10.pra.average!);
  });

  it("game log has every scope for each game", async () => {
    const playerId = await busiestPlayer();
    const logRows = await playerGameLog(fixture.engine, playerId, 2025);
    const scopesForFirstGame = logRows.filter((logRow) => logRow.game_id === logRows[0].game_id).map((logRow) => logRow.scope).sort();
    expect(scopesForFirstGame).toEqual(["FG", "H1", "H2", "Q1", "Q2", "Q3", "Q4", "T3"]);
  });

  it("hit rates count games over the line", async () => {
    const playerId = await busiestPlayer();
    const [hitResult] = await playerHitRates(fixture.engine, playerId, [{ propType: "points", lineValue: 0.5 }]);
    expect(hitResult.windows.L5.games).toBe(5);
    expect(hitResult.windows.L10.hitRate).toBeGreaterThan(0.5);
    const synthetic = computeHitRates(new Map([["FG", [10, 20, 30, 5, 25].map((points) => ({ pts: points }) as never)]]), [{ propType: "points", lineValue: 19.5 }]);
    expect(synthetic[0].windows.L5).toEqual({ hitRate: 0.6, games: 5, hits: 3 });
  });

  it("finds players by name", async () => {
    const [anyPlayer] = await fixture.engine.query<{ last_name: string }>(`SELECT last_name FROM players_latest LIMIT 1`);
    const matches = await searchPlayers(fixture.engine, anyPlayer.last_name.slice(0, 4));
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe("team aggregates", () => {
  it("computes pace, ratings and quarter scoring windows", async () => {
    const table = await teamWindowAggregates(fixture.engine, 2025);
    const teamIds = Object.keys(table).map(Number);
    expect(teamIds.length).toBe(30);
    const sample = table[teamIds[0]];
    expect(sample.FG!.L5.points.games).toBe(5);
    expect(sample.FG!.SEASON.pace_value.average).toBeGreaterThan(85);
    expect(sample.FG!.SEASON.off_rating.average).toBeGreaterThan(90);
    expect(sample.Q1!.SEASON.points.average! + sample.Q2!.SEASON.points.average!).toBeCloseTo(sample.H1!.SEASON.points.average!, 6);
  });

  it("derives rest days and back-to-backs", async () => {
    expect(restFromPreviousGame(1, "2026-01-01", "2026-01-02")).toMatchObject({ restDays: 0, backToBack: true });
    expect(restFromPreviousGame(1, "2026-01-01", "2026-01-04")).toMatchObject({ restDays: 2, backToBack: false });
    expect(restFromPreviousGame(1, null, "2026-01-04").restDays).toBeNull();
    const rest = await teamRest(fixture.engine, [1, 2], todayEastern());
    expect(rest.size).toBe(2);
  });
});

describe("defense vs position", () => {
  it("ranks 1-30 and splits allowed points across G/F/C", async () => {
    const table = await defenseVsPosition(fixture.engine, 2025);
    const teamIds = Object.keys(table).map(Number);
    expect(teamIds.length).toBe(30);
    const guardRanks = teamIds.map((teamId) => table[teamId].FG!.G.SEASON.pts.rank).filter((rank): rank is number => rank !== null).sort((first, second) => first - second);
    expect(guardRanks[0]).toBe(1);
    expect(guardRanks.at(-1)).toBeLessThanOrEqual(30);
    const teamId = teamIds[0];
    const groupTotal = (["G", "F", "C"] as const).reduce((runningTotal, group) => runningTotal + table[teamId].FG![group].SEASON.pts.average!, 0);
    const [allowedRow] = await fixture.engine.query<{ allowed: number }>(`SELECT AVG(opp_points) AS allowed FROM team_scope_lines WHERE team_id = ${teamId} AND season = 2025 AND scope = 'FG'`);
    expect(groupTotal).toBeCloseTo(allowedRow.allowed, 6);
    expect(table[teamId].Q3!.C.L10.reb.games).toBeGreaterThan(0);
  });
});

describe("usage shift", () => {
  it("shows teammates absorbing an injured player's minutes", async () => {
    const injured = mockInjuries().find((injury) => injury.status === "Out")!;
    const teamId = Math.floor(injured.playerId / 100);
    const starterId = teamId * 100 + (injured.playerId % 100 === 0 ? 1 : 0);
    const [shift] = await usageShift(fixture.engine, starterId, [injured.playerId], [2025, 2026]);
    expect(shift.withTeammate.games).toBeGreaterThan(0);
    if (shift.withoutTeammate.games > 0) expect(shift.deltas.minutes!).toBeGreaterThan(0);
  });
});

describe("100 in 3 quarters", () => {
  it("estimates the Q1-Q3 share and probability", async () => {
    const profiles = await threeQuarterProfiles(fixture.engine, [1, 2], [2025, 2026]);
    const current = profiles.find((profile) => profile.teamId === 1 && profile.season === 2026);
    const previous = profiles.find((profile) => profile.teamId === 1 && profile.season === 2025);
    const share = estimateThreeQuarterShare(current, previous);
    expect(share.share).toBeGreaterThan(0.68);
    expect(share.share).toBeLessThan(0.82);
    const projection = projectThreeQuarters(116, 0.75, 9);
    expect(projection.projection).toBeCloseTo(87, 6);
    expect(projection.probability).toBeGreaterThan(0.05);
    expect(projection.probability).toBeLessThan(0.15);
    expect(projectThreeQuarters(null, 0.75, 9).probability).toBeNull();
  });
});
