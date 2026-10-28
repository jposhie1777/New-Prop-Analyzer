import { readLocalJson, writeLocalJson } from "@/lib/client/safeStorage";
import type { TrackedPick } from "./tracker";

const trackerStorageKey = "pulse-nba-tracked-picks";
const maximumModelPicks = 4000; // a full season of the Lines model record (3 picks per game)
const maximumOtherPicks = 2500; // your own halftime, live, 100-in-3 and slip picks; both caps keep localStorage near 3 MB
const trackerListeners = new Set<(picks: TrackedPick[]) => void>();

export function readTracked(): TrackedPick[] {
  const stored = readLocalJson<TrackedPick[]>(trackerStorageKey, []);
  return Array.isArray(stored) ? stored.filter((pick) => pick && typeof pick.trackId === "string") : [];
}

function writeTracked(picks: TrackedPick[]): void {
  const modelPicks = picks.filter((pick) => pick.source === "model");
  const otherPicks = picks.filter((pick) => pick.source !== "model");
  const keptModel = new Set(modelPicks.slice(Math.max(0, modelPicks.length - maximumModelPicks))); // each group drops its own oldest, so the model record never pushes out your picks
  const keptOther = new Set(otherPicks.slice(Math.max(0, otherPicks.length - maximumOtherPicks)));
  const trimmed = picks.filter((pick) => keptModel.has(pick) || keptOther.has(pick));
  writeLocalJson(trackerStorageKey, trimmed);
  for (const listener of trackerListeners) listener(trimmed);
}

export function trackPicks(newPicks: Array<Omit<TrackedPick, "createdAt" | "result">>): number {
  if (newPicks.length === 0) return 0;
  const existing = readTracked();
  const knownIds = new Set(existing.map((pick) => pick.trackId));
  const additions = newPicks.filter((pick) => !knownIds.has(pick.trackId)).map((pick) => ({ ...pick, createdAt: new Date().toISOString(), result: null })); // first sighting wins: the price you could have bet
  if (additions.length > 0) writeTracked([...existing, ...additions]);
  return additions.length;
}

export function upsertPicks(latestPicks: Array<Omit<TrackedPick, "createdAt" | "result">>): number {
  if (latestPicks.length === 0) return 0;
  const existing = readTracked();
  const existingById = new Map(existing.map((pick) => [pick.trackId, pick]));
  let changes = 0;
  const merged = existing.map((pick) => {
    const latest = latestPicks.find((candidate) => candidate.trackId === pick.trackId);
    if (!latest || pick.result) return pick; // graded picks never change
    const changed = latest.lineValue !== pick.lineValue || latest.americanOdds !== pick.americanOdds || latest.side !== pick.side || latest.projectedValue !== pick.projectedValue;
    if (!changed) return pick;
    changes += 1;
    return { ...pick, ...latest, createdAt: new Date().toISOString() }; // keeps the last line seen before tip-off
  });
  const additions = latestPicks.filter((pick) => !existingById.has(pick.trackId)).map((pick) => ({ ...pick, createdAt: new Date().toISOString(), result: null }));
  changes += additions.length;
  if (changes > 0) writeTracked([...merged, ...additions]);
  return changes;
}

export function saveGrades(gradedPicks: TrackedPick[]): void {
  if (gradedPicks.length === 0) return;
  const gradedById = new Map(gradedPicks.map((pick) => [pick.trackId, pick]));
  writeTracked(readTracked().map((pick) => gradedById.get(pick.trackId) ?? pick));
}

export function removeTracked(trackIds: string[]): void {
  const removal = new Set(trackIds);
  writeTracked(readTracked().filter((pick) => !removal.has(pick.trackId)));
}

export function replaceTracked(picks: TrackedPick[]): void {
  writeTracked(picks.filter((pick) => pick && typeof pick.trackId === "string"));
}

export function subscribeTracked(listener: (picks: TrackedPick[]) => void): () => void {
  trackerListeners.add(listener);
  return () => trackerListeners.delete(listener);
}

const threeQuarterPruneKey = "pulse-nba-t3-recommendations-only";

export function pruneThreeQuarterPicks(minimumProbability: number, maximumPerDay: number): number {
  if (readLocalJson<number>(threeQuarterPruneKey, 0) === 1) return 0; // once: the record used to hold every team
  const existing = readTracked();
  const keptIds = new Set<string>();
  const byDay = new Map<string, TrackedPick[]>();
  for (const pick of existing.filter((candidate) => candidate.source === "100-in-3")) byDay.set(pick.gameDate, [...(byDay.get(pick.gameDate) ?? []), pick]);
  for (const dayPicks of byDay.values()) {
    dayPicks
      .filter((pick) => (pick.modelProbability ?? 0) >= minimumProbability)
      .sort((first, second) => (second.modelProbability ?? 0) - (first.modelProbability ?? 0))
      .slice(0, maximumPerDay)
      .forEach((pick) => keptIds.add(pick.trackId));
  }
  const removal = existing.filter((pick) => pick.source === "100-in-3" && !keptIds.has(pick.trackId)).map((pick) => pick.trackId);
  removeTracked(removal);
  writeLocalJson(threeQuarterPruneKey, 1);
  return removal.length;
}
