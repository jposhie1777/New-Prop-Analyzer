import { readLocalJson, writeLocalJson } from "@/lib/client/safeStorage";
import type { TrackedPick } from "./tracker";

const trackerStorageKey = "pulse-nba-tracked-picks";
const maximumTracked = 4000; // keeps localStorage well under its quota
const trackerListeners = new Set<(picks: TrackedPick[]) => void>();

export function readTracked(): TrackedPick[] {
  const stored = readLocalJson<TrackedPick[]>(trackerStorageKey, []);
  return Array.isArray(stored) ? stored.filter((pick) => pick && typeof pick.trackId === "string") : [];
}

function writeTracked(picks: TrackedPick[]): void {
  const trimmed = picks.length > maximumTracked ? picks.slice(picks.length - maximumTracked) : picks;
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
