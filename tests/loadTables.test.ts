import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMockAnalytics, mockDates, type MockAnalyticsFixture } from "./helpers/mockAnalytics";
import { addDays, todayEastern } from "@/lib/dates";

let fixture: MockAnalyticsFixture;

beforeAll(async () => {
  const yesterday = addDays(todayEastern(), -1);
  fixture = await buildMockAnalytics(mockDates("2026-03-01", "2026-03-20"), [addDays(yesterday, -1), yesterday]);
});

afterAll(() => fixture?.engine.close());

describe("analytics table loading", () => {
  it("combines baseline Parquet and top-up JSON without losing rows", () => {
    const expectedGames = [...fixture.baselinePayloads, ...fixture.topUpPayloads].reduce((runningTotal, payload) => runningTotal + payload.tables.games.length, 0);
    const expectedStats = [...fixture.baselinePayloads, ...fixture.topUpPayloads].reduce((runningTotal, payload) => runningTotal + payload.tables.player_game_stats.length, 0);
    expect(fixture.summary.tableRowCounts.games).toBe(expectedGames);
    expect(fixture.summary.tableRowCounts.player_game_stats).toBe(expectedStats);
    expect(fixture.summary.tableRowCounts.teams).toBe(30);
    expect(fixture.summary.warnings).toEqual([]);
  });

  it("builds scope lines where halves add up to the full game", async () => {
    const [mismatchRow] = await fixture.engine.query<{ mismatches: number }>(`
      SELECT COUNT(*) AS mismatches FROM (
        SELECT game_id, player_id, SUM(pts) FILTER (WHERE scope IN ('H1', 'H2')) AS half_points, SUM(pts) FILTER (WHERE scope = 'FG') AS full_points
        FROM player_scope_lines GROUP BY game_id, player_id
      ) WHERE half_points <> full_points`);
    expect(mismatchRow.mismatches).toBe(0);
  });

  it("assigns every player-game a G/F/C position group", async () => {
    const groups = await fixture.engine.query<{ position_group: string }>(`SELECT DISTINCT position_group FROM player_game_positions ORDER BY 1`);
    expect(groups.map((groupRow) => groupRow.position_group)).toEqual(["C", "F", "G"]);
  });

  it("team scope lines carry pace inputs", async () => {
    const [teamRow] = await fixture.engine.query<{ average_pace: number }>(`SELECT AVG((possessions + opp_possessions) / 2 * 48 / minutes) AS average_pace FROM team_scope_lines WHERE scope = 'FG'`);
    expect(teamRow.average_pace).toBeGreaterThan(85);
    expect(teamRow.average_pace).toBeLessThan(115);
  });
});
