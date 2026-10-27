import { describe, expect, it } from "vitest";
import { aggregateShotZones, classifyShotZone } from "@/lib/data/shotZones";
import { compareZones, defaultShotSeason, type DefenseZoneLine, type ZoneLine } from "@/lib/analytics/aggregates/shotZones";
import type { BdlShotChartRow } from "@/lib/bdl/types";

describe("classifyShotZone", () => {
  it("uses BDL zone names", () => {
    expect(classifyShotZone({ shot_value: 3, shot_distance: 23, shot_zone_basic: "Left Corner 3", shot_zone_area: "Left Side(L)" })).toBe("corner3_left");
    expect(classifyShotZone({ shot_value: 3, shot_distance: 26, shot_zone_basic: "Above the Break 3", shot_zone_area: "Right Side Center(RC)" })).toBe("above3_right");
    expect(classifyShotZone({ shot_value: 3, shot_distance: 25, shot_zone_basic: "Above the Break 3", shot_zone_area: "Center(C)" })).toBe("above3_center");
    expect(classifyShotZone({ shot_value: 2, shot_distance: 2, shot_zone_basic: "Restricted Area", shot_zone_area: "Center(C)" })).toBe("rim");
    expect(classifyShotZone({ shot_value: 2, shot_distance: 7, shot_zone_basic: "In The Paint (Non-RA)", shot_zone_area: "Center(C)" })).toBe("paint");
    expect(classifyShotZone({ shot_value: 2, shot_distance: 16, shot_zone_basic: "Mid-Range", shot_zone_area: "Left Side Center(LC)" })).toBe("mid_left");
  });
  it("falls back to distance and court position", () => {
    expect(classifyShotZone({ shot_value: 2, shot_distance: 3, shot_zone_basic: null })).toBe("rim");
    expect(classifyShotZone({ shot_value: 2, shot_distance: 15, shot_zone_basic: null, coordinate_x: 40 })).toBe("mid_right");
    expect(classifyShotZone({ shot_value: 3, shot_distance: 24, shot_zone_basic: "Right Corner 3", coordinate_x: 49.6 })).toBe("corner3_right");
    expect(classifyShotZone({ shot_value: 3, shot_distance: 60, shot_zone_basic: "Backcourt" })).toBeNull();
  });
});

describe("aggregateShotZones", () => {
  it("sums attempts and makes per player, game and zone with the opponent", () => {
    const shot = (made: boolean) => ({ id: 1, game_id: 7, player_id: 3, team_id: 10, season: 2026, period: 1, clock: "5:00", made, shot_value: 3, shot_type: "Jump Shot", shot_distance: 25, shot_zone_basic: "Above the Break 3", shot_zone_area: "Center(C)" }) as BdlShotChartRow;
    const rows = aggregateShotZones([shot(true), shot(false), shot(true)], new Map([[7, { season: 2026, gameDate: "2026-10-25", homeTeamId: 10, visitorTeamId: 20 }]]));
    expect(rows).toEqual([{ season: 2026, game_date: "2026-10-25", game_id: 7, player_id: 3, team_id: 10, opponent_team_id: 20, zone: "above3_center", attempts: 3, makes: 2 }]);
  });
});

describe("compareZones", () => {
  const playerLine = (attempts: number, makes: number): ZoneLine => ({ zone: "above3_left", attempts, makes, games: 10, percent: makes / attempts, perGame: attempts / 10 });
  const defenseLine = (attempts: number, makes: number): DefenseZoneLine => ({ ...playerLine(attempts, makes), rank: 25, teams: 30 });
  const league = new Map([["above3_left" as const, 0.36]]);
  it("adds the player's edge and the defense's leak, shrunk toward the league", () => {
    const [comparison] = compareZones(new Map([["above3_left", playerLine(40, 18)]]), new Map([["above3_left", defenseLine(200, 84)]]), league).filter((entry) => entry.zone === "above3_left");
    const playerShrunk = (18 + 12 * 0.36) / 52;
    const defenseShrunk = (84 + 40 * 0.36) / 240;
    expect(comparison.edge).toBeCloseTo(playerShrunk - 0.36 + defenseShrunk - 0.36, 9);
    expect(comparison.shotShare).toBe(1);
  });
  it("a hot 2-for-2 barely moves the needle", () => {
    const [comparison] = compareZones(new Map([["above3_left", playerLine(2, 2)]]), null, league).filter((entry) => entry.zone === "above3_left");
    expect(comparison.edge!).toBeLessThan(0.1);
  });
});

describe("defaultShotSeason", () => {
  it("falls back to last season until there are enough games", () => {
    expect(defaultShotSeason([2026, 2025], new Map([[2026, 2], [2025, 70]]))).toBe(2025);
    expect(defaultShotSeason([2026, 2025], new Map([[2026, 6], [2025, 70]]))).toBe(2026);
    expect(defaultShotSeason([2026, 2025], new Map([[2026, 1]]))).toBe(2026);
  });
});
