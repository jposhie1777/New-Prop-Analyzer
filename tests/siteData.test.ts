import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot, type AnalyticsSnapshot } from "@/lib/data/snapshot";
import { emptySyncState, mergeSyncState } from "@/lib/sync/syncState";

describe("snapshot encoding", () => {
  it("keeps Maps and rounds long decimals", () => {
    const snapshot = { version: 1, generatedAt: "2026-10-28T10:23:00Z", forDate: "2026-10-28", dataThrough: "2026-10-27", currentSeason: 2026, teamRest: new Map([[1, { restDays: 1, backToBack: false }]]), recentTeamGameIds: new Map([[1, [10, 11]]]), teamRatings: { pace: 99.123456 } } as unknown as AnalyticsSnapshot;
    const decoded = decodeSnapshot(encodeSnapshot(snapshot))!;
    expect(decoded.teamRest).toBeInstanceOf(Map);
    expect(decoded.teamRest.get(1)).toEqual({ restDays: 1, backToBack: false });
    expect(decoded.recentTeamGameIds.get(1)).toEqual([10, 11]);
    expect((decoded.teamRatings as unknown as { pace: number }).pace).toBe(99.123);
  });
  it("rejects other versions and bad JSON", () => {
    expect(decodeSnapshot('{"version":99}')).toBeNull();
    expect(decodeSnapshot("not json")).toBeNull();
  });
});

describe("sync merge", () => {
  it("keeps the newest change for each section", () => {
    const stored = { slip: { value: [1], updatedAt: "2026-10-28T10:00:00Z" }, settings: { value: { defaultBook: "fanduel" }, updatedAt: "2026-10-28T12:00:00Z" } };
    const merged = mergeSyncState(stored, { slip: { value: [], updatedAt: "2026-10-28T11:00:00Z" }, settings: { value: { defaultBook: "draftkings" }, updatedAt: "2026-10-28T09:00:00Z" } });
    expect(merged.slip?.value).toEqual([]);
    expect(merged.settings?.value).toEqual({ defaultBook: "fanduel" });
  });
  it("fills an empty store", () => {
    expect(mergeSyncState(emptySyncState(), { slip: { value: [2], updatedAt: "2026-10-28T10:00:00Z" } }).slip?.value).toEqual([2]);
  });
});
