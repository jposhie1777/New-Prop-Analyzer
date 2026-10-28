import { describe, expect, it } from "vitest";
import { buildShootingSpots, filteredBoost, type SlateShotData } from "@/lib/analytics/aggregates/shotMatchups";
import type { ShotZoneKey } from "@/lib/data/shotZones";

function counts(entries: Array<[ShotZoneKey, number, number]>) {
  return new Map(entries.map(([zone, attempts, makes]) => [zone, { attempts, makes }]));
}

const league = new Map<ShotZoneKey, number>([
  ["rim", 0.65],
  ["corner3_right", 0.38],
  ["above3_center", 0.35],
]);

function slate(defenseCornerMakes: number): SlateShotData {
  return {
    season: 2026,
    league,
    players: [
      { playerId: 1, name: "Corner Shooter", teamId: 10, games: 10, zones: counts([["corner3_right", 40, 18], ["rim", 40, 26]]), priorZones: new Map() },
      { playerId: 2, name: "Low Volume", teamId: 10, games: 10, zones: counts([["rim", 30, 20]]), priorZones: new Map() },
    ],
    defenses: new Map([
      [20, { games: 10, zones: counts([["corner3_right", 200, defenseCornerMakes], ["rim", 300, 195], ["above3_center", 300, 105]]), priorZones: new Map() }],
      [10, { games: 10, zones: counts([["corner3_right", 200, 76], ["rim", 300, 195], ["above3_center", 300, 105]]), priorZones: new Map() }],
    ]),
  };
}

const matchups = [
  { teamId: 10, opponentId: 20, gameId: 99 },
  { teamId: 20, opponentId: 10, gameId: 99 },
];

describe("shooting spots", () => {
  it("rewards shooting where the defense leaks and marks the sweet spot", () => {
    const { players } = buildShootingSpots(slate(100), matchups, new Set());
    expect(players.map((spot) => spot.playerId)).toEqual([1]); // 3 shots a game is below the volume floor
    const shooter = players[0];
    expect(shooter.threeBoost).toBeGreaterThan(0.2);
    expect(filteredBoost(shooter, "three")).toBeCloseTo(shooter.threeBoost * 3, 9);
    expect(shooter.zones.find((spotZone) => spotZone.zone === "corner3_right")?.sweet).toBe(true);
  });
  it("is negative against a defense that takes the zone away", () => {
    const { players } = buildShootingSpots(slate(50), matchups, new Set());
    expect(players[0].threeBoost).toBeLessThan(0);
  });
  it("skips players listed out and lists the leakiest zones for each defense", () => {
    const result = buildShootingSpots(slate(100), matchups, new Set([1]));
    expect(result.players).toHaveLength(0);
    expect(result.defenses.find((defense) => defense.teamId === 20)?.zones[0].zone).toBe("corner3_right");
  });
});
