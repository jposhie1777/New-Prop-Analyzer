"use client";

import type { TrackedPick } from "@/lib/tracking/tracker";
import type { LineSample } from "@/lib/analytics/lineLearning";
import { readTracked, removeTracked } from "@/lib/tracking/trackerStore";

const databaseName = "pulse-nba-lines"; // its own database so the finals store never needs a schema change
const databaseVersion = 1;
const picksStoreName = "picks";
const samplesStoreName = "samples";

type NewPick = Omit<TrackedPick, "createdAt" | "result">;

let picksCache: TrackedPick[] | null = null;
let samplesCache: LineSample[] | null = null;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emptyPicks: TrackedPick[] = [];

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const openRequest = indexedDB.open(databaseName, databaseVersion);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        if (!database.objectStoreNames.contains(picksStoreName)) database.createObjectStore(picksStoreName, { keyPath: "trackId" });
        if (!database.objectStoreNames.contains(samplesStoreName)) database.createObjectStore(samplesStoreName, { keyPath: "gameId" });
      };
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => resolve(null);
      openRequest.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function requestToPromise<ResultType>(request: IDBRequest<ResultType>): Promise<ResultType> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStore<ItemType>(storeName: string): Promise<ItemType[]> {
  const database = await openDatabase();
  if (!database) return [];
  try {
    return await requestToPromise(database.transaction(storeName, "readonly").objectStore(storeName).getAll() as IDBRequest<ItemType[]>);
  } catch {
    return [];
  } finally {
    database.close();
  }
}

async function writeStore<ItemType>(storeName: string, items: ItemType[]): Promise<void> {
  if (items.length === 0) return;
  const database = await openDatabase();
  if (!database) return; // no IndexedDB: the in-memory copy still works for this visit
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const item of items) store.put(item);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function ensureLineStoreLoaded(): Promise<void> {
  loadPromise ??= (async () => {
    const [storedPicks, storedSamples] = await Promise.all([readStore<TrackedPick>(picksStoreName), readStore<LineSample>(samplesStoreName)]);
    const legacyPicks = readTracked().filter((pick) => pick.source === "model"); // model picks used to live in localStorage
    const storedIds = new Set(storedPicks.map((pick) => pick.trackId));
    const movedPicks = legacyPicks.filter((pick) => !storedIds.has(pick.trackId));
    if (movedPicks.length > 0) await writeStore(picksStoreName, movedPicks);
    if (legacyPicks.length > 0) removeTracked(legacyPicks.map((pick) => pick.trackId));
    picksCache = [...storedPicks, ...movedPicks];
    samplesCache = storedSamples;
    notify();
  })();
  return loadPromise;
}

export function subscribeLineStore(listener: () => void): () => void {
  listeners.add(listener);
  void ensureLineStoreLoaded();
  return () => listeners.delete(listener);
}

export function linePicksSnapshot(): TrackedPick[] {
  return picksCache ?? emptyPicks;
}

export function lineStoreLoaded(): boolean {
  return picksCache !== null;
}

export async function readLineSamples(): Promise<LineSample[]> {
  await ensureLineStoreLoaded();
  return samplesCache ?? [];
}

export async function saveLineSamples(samples: LineSample[]): Promise<void> {
  await ensureLineStoreLoaded();
  const byGame = new Map((samplesCache ?? []).map((sample) => [sample.gameId, sample]));
  for (const sample of samples) byGame.set(sample.gameId, sample);
  samplesCache = [...byGame.values()];
  await writeStore(samplesStoreName, samples);
}

export async function addLinePicks(newPicks: NewPick[]): Promise<number> {
  await ensureLineStoreLoaded();
  const knownIds = new Set((picksCache ?? []).map((pick) => pick.trackId));
  const additions: TrackedPick[] = newPicks.filter((pick) => !knownIds.has(pick.trackId)).map((pick) => ({ ...pick, createdAt: new Date().toISOString(), result: null })); // existing picks, live ones included, are never replaced
  if (additions.length === 0) return 0;
  picksCache = [...(picksCache ?? []), ...additions];
  await writeStore(picksStoreName, additions);
  notify();
  return additions.length;
}

export async function upsertLinePicks(latestPicks: NewPick[]): Promise<number> {
  await ensureLineStoreLoaded();
  const byId = new Map((picksCache ?? []).map((pick) => [pick.trackId, pick]));
  const changed: TrackedPick[] = [];
  for (const latest of latestPicks) {
    const existing = byId.get(latest.trackId);
    if (existing?.result) continue; // graded picks never change
    const same = existing && existing.lineValue === latest.lineValue && existing.americanOdds === latest.americanOdds && existing.side === latest.side && existing.projectedValue === latest.projectedValue;
    if (same) continue;
    const next: TrackedPick = { ...(existing ?? {}), ...latest, createdAt: new Date().toISOString(), result: null }; // keeps the last line seen before tip-off
    byId.set(latest.trackId, next);
    changed.push(next);
  }
  if (changed.length === 0) return 0;
  picksCache = [...byId.values()];
  await writeStore(picksStoreName, changed);
  notify();
  return changed.length;
}

export async function saveLinePickGrades(gradedPicks: TrackedPick[]): Promise<void> {
  if (gradedPicks.length === 0) return;
  await ensureLineStoreLoaded();
  const gradedById = new Map(gradedPicks.map((pick) => [pick.trackId, pick]));
  picksCache = (picksCache ?? []).map((pick) => gradedById.get(pick.trackId) ?? pick);
  await writeStore(picksStoreName, gradedPicks);
  notify();
}
