import { describe, expect, it } from "vitest";
import { BdlClient } from "@/lib/bdl/bdlClient";
import { buildFinalsPayload } from "@/lib/server/finalsBuilder";
import { addDays, todayEastern } from "@/lib/dates";
import { mockGamesForDate } from "@/lib/bdl/mock/mockWorld";
import { handleMockRequest } from "@/lib/bdl/mock/mockApi";
import { buildTeamPeriodSummaries, estimatePossessions, paceFor } from "@/lib/data/teamSummaries";
import type { BdlGame, BdlPlay } from "@/lib/bdl/types";
import { bdlTeam } from "@/lib/nba/teams";

describe("finals builder (mock)", () => {
  it("builds flattened tables for a finished date", async () => {
    const client = new BdlClient({ tier: "mock" });
    const yesterday = addDays(todayEastern(), -1);
    const payload = await buildFinalsPayload(client, yesterday);
    const expectedGames = mockGamesForDate(yesterday).length;
    expect(payload.complete).toBe(true);
    expect(payload.tables.games).toHaveLength(expectedGames);
    expect(payload.tables.player_game_stats.length).toBeGreaterThan(expectedGames * 15);
    expect(payload.tables.player_period_stats.length).toBeGreaterThan(payload.tables.player_game_stats.length * 3);
    expect(payload.tables.team_period_summaries).toHaveLength(expectedGames * 2 * 4);
    expect(payload.tables.lineups.length).toBeGreaterThan(0);
    expect(payload.tables.advanced_stats.some((advancedRow) => advancedRow.period === 3)).toBe(true);
    expect(payload.bdlCalls).toBeGreaterThan(5);
  });

  it("team summaries from play-by-play match final scores", async () => {
    const client = new BdlClient({ tier: "mock" });
    const yesterday = addDays(todayEastern(), -1);
    const payload = await buildFinalsPayload(client, yesterday);
    for (const gameRow of payload.tables.games) {
      const homeRows = payload.tables.team_period_summaries.filter((summaryRow) => summaryRow.game_id === gameRow.game_id && summaryRow.team_id === gameRow.home_team_id);
      expect(homeRows.reduce((runningTotal, summaryRow) => runningTotal + Number(summaryRow.points), 0)).toBe(gameRow.home_score);
      expect(homeRows.every((summaryRow) => summaryRow.possessions_source === "play_by_play")).toBe(true);
    }
    const paceValues = payload.tables.team_period_summaries.map((summaryRow) => Number(summaryRow.pace));
    const averagePace = paceValues.reduce((runningTotal, paceValue) => runningTotal + paceValue, 0) / paceValues.length;
    expect(averagePace).toBeGreaterThan(85);
    expect(averagePace).toBeLessThan(115);
  });

  it("returns empty tables for a day with no games", async () => {
    const payload = await buildFinalsPayload(new BdlClient({ tier: "mock" }), "2026-08-01");
    expect(payload.tables.games).toHaveLength(0);
    expect(payload.complete).toBe(true);
  });
});

describe("possession math", () => {
  it("estimates possessions and pace", () => {
    expect(estimatePossessions({ fieldGoalAttempts: 22, freeThrowAttempts: 6, offensiveRebounds: 3, turnovers: 4 })).toBeCloseTo(25.64, 2);
    expect(paceFor(25, 25, 12)).toBe(100);
    expect(paceFor(10, 10, 5)).toBeCloseTo(96, 6);
  });

  it("falls back to box score counts when plays are missing", () => {
    const game = { id: 1, date: "2026-01-01", season: 2025, home_team: bdlTeam(1), visitor_team: bdlTeam(2) } as BdlGame;
    const periodRows = [
      { team_id: 1, period: 1, pts: 30, fga: 22, fta: 6, oreb: 3, turnover: 4 },
      { team_id: 2, period: 1, pts: 25, fga: 20, fta: 4, oreb: 2, turnover: 5 },
    ];
    const summaries = buildTeamPeriodSummaries(game, [] as BdlPlay[], periodRows);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ team_id: 1, points: 30, opp_points: 25, possessions_source: "box_score" });
  });
});

describe("mock fixtures", () => {
  it("include a halftime game and a live game today", () => {
    const liveScores = handleMockRequest("/nba/v1/box_scores/live", {}) as { data: Array<{ status: string }> };
    expect(liveScores.data.some((boxScore) => boxScore.status === "Halftime")).toBe(true);
    expect(liveScores.data.length).toBeGreaterThanOrEqual(2);
  });
});
