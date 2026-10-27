import { fetchApi } from "./apiClient";
import type { AppConfig } from "./appConfig";
import { deleteFinalsThrough, readAllFinals, saveFinals } from "./idbStore";
import { isBaselineManifest, type BaselineManifest } from "@/lib/data/manifest";
import type { FinalsPayload } from "@/lib/data/rowSchemas";
import { addDays } from "@/lib/dates";

interface SeasonDatesResponse {
  season: number;
  today: string;
  dates: Array<{ date: string; games: number; final: number }>;
}

export const finalsPayloadVersion = 2; // bump when the finals payload gains a table

export interface TopUpProgress {
  totalDates: number;
  completedDates: number;
  currentDate: string | null;
}

export async function loadManifest(baselinePath: string): Promise<BaselineManifest | null> {
  try {
    const response = await fetch(`${baselinePath}/manifest.json`, { cache: "no-cache" });
    if (!response.ok) return null; // no baseline yet, the top-up covers everything it can
    const parsed: unknown = await response.json();
    return isBaselineManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function planTopUpDates(config: AppConfig, manifest: BaselineManifest | null, today: string): Promise<string[]> {
  const seasonsToCover: Array<{ season: number; afterDate: string | null }> = [];
  if (!manifest?.seasons[String(config.lastSeason)]) seasonsToCover.push({ season: config.lastSeason, afterDate: null }); // no baseline for last season: fetch it date by date
  seasonsToCover.push({ season: config.currentSeason, afterDate: manifest?.seasons[String(config.currentSeason)]?.lastDate ?? manifest?.lastDate ?? null });
  const plannedDates: string[] = [];
  for (const { season, afterDate } of seasonsToCover) {
    const startParam = afterDate ? `&start_date=${addDays(afterDate, 1)}` : "";
    const seasonDates = await fetchApi<SeasonDatesResponse>(`/api/season-dates?season=${season}${startParam}`);
    for (const dateEntry of seasonDates.dates) {
      if (dateEntry.final === 0 || dateEntry.date >= today) continue; // today is never final
      if (afterDate && dateEntry.date <= afterDate) continue;
      plannedDates.push(dateEntry.date);
    }
  }
  return [...new Set(plannedDates)].sort();
}

export async function runTopUp(config: AppConfig, manifest: BaselineManifest | null, today: string, onProgress: (progress: TopUpProgress) => void): Promise<FinalsPayload[]> {
  if (manifest?.lastDate) await deleteFinalsThrough(manifest.lastDate); // the baseline already has these dates
  const storedPayloads = new Map((await readAllFinals()).map((payload) => [payload.date, payload]));
  const plannedDates = await planTopUpDates(config, manifest, today);
  const missingDates = plannedDates.filter((plannedDate) => {
    const stored = storedPayloads.get(plannedDate);
    return !stored?.complete || stored.tables.shot_zones === undefined; // payloads saved before shot zones existed are fetched again
  });
  let completedCount = 0;
  onProgress({ totalDates: missingDates.length, completedDates: 0, currentDate: missingDates[0] ?? null });
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(3, missingDates.length) }, async () => {
    while (nextIndex < missingDates.length) {
      const targetDate = missingDates[nextIndex++];
      try {
        const payload = await fetchApi<FinalsPayload>(`/api/finals?date=${targetDate}&v=${finalsPayloadVersion}`); // the version is part of the CDN cache key, so old cached payloads are skipped
        storedPayloads.set(targetDate, payload);
        await saveFinals(payload);
      } catch {
        continue; // one failed date is retried on the next page load
      } finally {
        completedCount += 1;
        onProgress({ totalDates: missingDates.length, completedDates: completedCount, currentDate: targetDate });
      }
    }
  });
  await Promise.all(runners);
  const keepAfter = manifest?.lastDate ?? "";
  return [...storedPayloads.values()].filter((payload) => payload.date > keepAfter && payload.date < today);
}
