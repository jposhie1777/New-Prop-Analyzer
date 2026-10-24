import { describe, expect, it } from "vitest";
import { normalizeBoxScores } from "@/lib/bdl/normalize";
import { bdlTeam } from "@/lib/nba/teams";

const boxPlayer = { min: "12", pts: 8, reb: 2, ast: 1, player: { id: 5, first_name: "A", last_name: "B", position: "G" } };

describe("live box score normalization", () => {
  it("accepts the live API shape with team fields beside players", () => {
    const [boxScore] = normalizeBoxScores([{ date: "2026-10-24", status: "2nd Qtr", home_team: { ...bdlTeam(2), players: [boxPlayer] }, visitor_team: { ...bdlTeam(20), players: [] } }]);
    expect(boxScore.home_team.team.abbreviation).toBe("BOS");
    expect(boxScore.home_team.players).toHaveLength(1);
  });

  it("accepts the spec shape and drops malformed rows", () => {
    const normalized = normalizeBoxScores([
      { home_team: { team: bdlTeam(1), players: [boxPlayer, { min: "1" }] }, visitor_team: { team: bdlTeam(3), players: [] } },
      { home_team: null, visitor_team: { team: bdlTeam(3) } },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].home_team.players).toHaveLength(1);
  });
});
