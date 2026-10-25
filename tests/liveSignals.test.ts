import { describe, expect, it } from "vitest";
import { buildShotProfiles, inactivityNote, leagueZoneRates, parseLivePlays, readLiveMarket, shootingCheck, volumeFactors, zoneForShot } from "@/lib/analytics/liveSignals";
import { projectLiveStat } from "@/lib/analytics/liveProjection";
import type { BdlBettingOdd, BdlBoxScorePlayer, BdlPlay, BdlShotChartRow } from "@/lib/bdl/types";
import type { QuarterProfile } from "@/lib/analytics/aggregates/playerAggregates";

const players = [
  { id: 1, name: "Nikola Jokić" },
  { id: 2, name: "Jamal Murray" },
  { id: 3, name: "Christian Braun" },
];

function play(order: number, period: number, clock: string, text: string, extra: Partial<BdlPlay> = {}): BdlPlay {
  return { game_id: 9, order, type: "Jump Shot", text, home_score: 0, away_score: 0, period, period_display: `Q${period}`, clock, scoring_play: false, shooting_play: false, score_value: 0, team: null, ...extra };
}

function quarterProfile(perQuarter: Partial<Record<string, number>>): QuarterProfile {
  const metrics = Object.fromEntries(Object.entries(perQuarter).map(([metricName, average]) => [metricName, { average, variance: 1 }]));
  return { playerId: 1, games: 10, quarters: { 1: metrics, 2: metrics, 3: metrics, 4: metrics } } as unknown as QuarterProfile;
}

describe("zoneForShot", () => {
  it("sorts shots by distance and type", () => {
    expect(zoneForShot(25, 3, "Jump Shot")).toBe("three");
    expect(zoneForShot(null, 0, "misses three point jumper")).toBe("three");
    expect(zoneForShot(null, 0, "driving layup")).toBe("rim");
    expect(zoneForShot(7, 2, "Jump Shot")).toBe("short");
    expect(zoneForShot(14, 2, "Jump Shot")).toBe("mid");
    expect(zoneForShot(19, 2, "Jump Shot")).toBe("long");
  });
});

describe("buildShotProfiles", () => {
  it("shrinks a small sample toward the league rate", () => {
    const shots = Array.from({ length: 5 }, (_, shotIndex) => ({ id: shotIndex, game_id: 1, player_id: 7, team_id: 1, season: 2026, period: 1, clock: "5:00", made: true, shot_value: 3, shot_type: "Jump Shot", shot_distance: 25 })) as BdlShotChartRow[];
    const profile = buildShotProfiles(shots).get(7)!;
    expect(profile.zoneAttempts.three).toBe(5);
    expect(profile.zoneRates.three).toBeGreaterThan(leagueZoneRates.three);
    expect(profile.zoneRates.three).toBeLessThan(0.6); // 5 for 5 is not a 100% shooter
  });
});

describe("parseLivePlays", () => {
  const plays = [
    play(1, 1, "11:30", "Nikola Jokic makes 6-foot jumper (Jamal Murray assists)", { shooting_play: true, scoring_play: true, score_value: 2 }),
    play(2, 1, "10:50", "Jamal Murray misses 26-foot three point jumper", { shooting_play: true }),
    play(3, 1, "9:00", "Christian Braun personal foul", { type: "Personal Foul" }),
    play(4, 1, "8:00", "Jamal Murray makes free throw 1 of 2", { type: "Free Throw - 1 of 2", shooting_play: true, scoring_play: true, score_value: 1 }),
    play(5, 2, "11:00", "Peyton Watson enters the game for Christian Braun", { type: "Substitution" }),
    play(6, 2, "1:00", "Nikola Jokic defensive rebound"),
  ];
  const activity = parseLivePlays(plays, players);

  it("matches names without accents and logs shots by zone", () => {
    expect(activity.get(1)!.shots).toEqual([{ playerId: 1, zone: "short", value: 2, made: true }]);
    expect(activity.get(2)!.shots).toEqual([{ playerId: 2, zone: "three", value: 3, made: false }]); // free throws are left to the box score
  });

  it("records fouls and substitutions", () => {
    expect(activity.get(3)!.foulTimes).toEqual(["Q1 9:00"]);
    expect(activity.get(3)!.subbedOut).toBe(true);
    expect(activity.get(3)!.lastSeenLabel).toBe("Q2 11:00");
    expect(activity.get(1)!.lastSeenLabel).toBe("Q2 1:00");
  });

  it("warns only after a long absence", () => {
    const halftime = { period: 2, secondsLeftInPeriod: 0, isHalftime: true, isFinished: false };
    expect(inactivityNote(activity.get(3), halftime, 14)).toBe("Out since Q2 11:00: check for injury news");
    expect(inactivityNote(activity.get(1), halftime, 18)).toBeNull();
    expect(inactivityNote(activity.get(3), { period: 2, secondsLeftInPeriod: 300, isHalftime: false, isFinished: false }, 14)).toBeNull(); // only 6 minutes on the bench
  });
});

describe("shootingCheck", () => {
  const boxPlayer = { min: "18:00", pts: 4, fga: 10, fg3a: 4, fg3m: 0, fta: 2, ftm: 2, player: { id: 1 } } as unknown as BdlBoxScorePlayer;
  it("falls back to the box score and flags a cold half", () => {
    const check = shootingCheck(boxPlayer, undefined, undefined, undefined)!;
    expect(check.source).toBe("box score");
    expect(check.expectedPoints).toBeCloseTo(6 * 0.53 * 2 + 4 * 0.36 * 3 + 2 * 0.78, 6);
    expect(check.luck).toBeLessThan(-5);
  });
  it("uses play-by-play shots when they cover the attempts", () => {
    const shots = [...Array.from({ length: 6 }, () => ({ playerId: 1, zone: "rim" as const, value: 2 as const, made: false })), ...Array.from({ length: 4 }, () => ({ playerId: 1, zone: "three" as const, value: 3 as const, made: false }))];
    const check = shootingCheck(boxPlayer, shots, undefined, undefined)!;
    expect(check.source).toBe("play-by-play");
    expect(check.expectedPoints).toBeGreaterThan(6 * 0.53 * 2 + 4 * 0.36 * 3 + 2 * 0.78); // rim shots are worth more than an average two
  });
});

describe("volumeFactors", () => {
  it("raises scoring when he is shooting more than usual, capped", () => {
    const profile = quarterProfile({ minutes: 8, fga: 4, fg3a: 1.5, fta: 1, fgm: 2, fg3m: 0.5, ftm: 0.8 });
    const busyNight = { fga: 16, fg3a: 6, fta: 4 } as unknown as BdlBoxScorePlayer;
    const factors = volumeFactors(busyNight, 18, profile)!;
    expect(factors.scoring).toBeGreaterThan(1);
    expect(factors.scoring).toBeLessThanOrEqual(1.25);
    expect(volumeFactors(busyNight, 4, profile)).toBeNull();
  });
});

describe("readLiveMarket", () => {
  const tipoff = "2026-10-25T23:00:00.000Z";
  const odd = (totalValue: string, spreadHome: string, updatedAt: string) => ({ id: 1, game_id: 9, vendor: "fanduel", total_value: totalValue, spread_home_value: spreadHome, updated_at: updatedAt }) as BdlBettingOdd;
  it("reads pace and margin from lines updated after tip-off", () => {
    const market = readLiveMarket([odd("232.5", "-16.5", "2026-10-26T00:30:00.000Z")], [odd("220", "-6", "2026-10-25T15:00:00.000Z")], 116, 0.5, tipoff)!;
    expect(market.paceFactor).toBeCloseTo(116.5 / 110, 6);
    expect(market.expectedFinalMarginHome).toBe(16.5);
  });
  it("ignores lines that still look pregame", () => {
    expect(readLiveMarket([odd("220", "-6", "2026-10-25T22:00:00.000Z")], [], 116, 0.5, tipoff)).toBeNull();
  });
});

describe("projectLiveStat signals", () => {
  const prior = { fullGameMean: 24, quarterShares: { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 }, dispersion: 2, source: "pregame line" } as const;
  const halftime = { period: 2, secondsLeftInPeriod: 0, isHalftime: true, isFinished: false };
  it("a cold half projects higher than a hot one with the same points", () => {
    const cold = projectLiveStat(10, prior, halftime, 1, 0, { paceBasis: 15 });
    const hot = projectLiveStat(10, prior, halftime, 1, 0, { paceBasis: 6 });
    expect(cold.projection).toBeGreaterThan(hot.projection);
  });
  it("a big live spread trims minutes in the second half", () => {
    const base = projectLiveStat(10, prior, halftime, 1, 4);
    const blowout = projectLiveStat(10, prior, halftime, 1, 4, { expectedFinalMargin: 18 });
    expect(blowout.remainingExpected).toBeCloseTo(base.remainingExpected * 0.85, 6);
  });
});
