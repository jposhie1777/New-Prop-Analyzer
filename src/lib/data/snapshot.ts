import type { LeagueRatings, InjuredScorer } from "@/lib/analytics/aggregates/teamRatings";
import type { RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import type { ThreeQuarterSeasonProfile } from "@/lib/analytics/aggregates/threeQuarters";
import type { QuarterProfile } from "@/lib/analytics/aggregates/playerAggregates";

export const snapshotVersion = 1;

export interface AnalyticsSnapshot {
  version: typeof snapshotVersion;
  generatedAt: string;
  forDate: string; // the slate date the rest days were worked out for
  dataThrough: string | null; // last finished date in the stats behind it
  currentSeason: number;
  teamRatings: LeagueRatings;
  teamRest: Map<number, RestInfo>;
  injuredScorers: Map<number, InjuredScorer>; // every player with games, so any injury list can be looked up
  threeQuarterProfiles: ThreeQuarterSeasonProfile[]; // all 30 teams, this season and last
  quarterProfiles: Map<number, QuarterProfile>; // last 10 games for every player with games this season or last
  recentTeamGameIds: Map<number, number[]>;
}

export function encodeSnapshot(snapshot: AnalyticsSnapshot): string {
  return JSON.stringify(snapshot, (_key, value: unknown) => {
    if (value instanceof Map) return { __map: [...value.entries()] }; // JSON has no Map, so Maps travel as entry lists
    if (typeof value === "number" && !Number.isInteger(value)) return Math.round(value * 1000) / 1000; // 3 decimals is plenty and halves the file
    return value;
  });
}

export function decodeSnapshot(text: string): AnalyticsSnapshot | null {
  try {
    const decoded = JSON.parse(text, (_key, value: unknown) => (value && typeof value === "object" && "__map" in value ? new Map((value as { __map: Array<[unknown, unknown]> }).__map) : value)) as AnalyticsSnapshot;
    return decoded?.version === snapshotVersion ? decoded : null;
  } catch {
    return null;
  }
}
