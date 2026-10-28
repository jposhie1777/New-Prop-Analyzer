"use client";

import { useEffect, useState } from "react";
import { loadAppConfig } from "./appConfig";
import { useAnalyticsQuery } from "./hooks";
import type { AnalyticsHandle } from "./analyticsStore";
import { decodeSnapshot, type AnalyticsSnapshot } from "@/lib/data/snapshot";
import { todayEastern } from "@/lib/dates";

let snapshotPromise: Promise<AnalyticsSnapshot | null> | null = null;
let settledSnapshot: AnalyticsSnapshot | null | undefined; // undefined until the first fetch finishes

export function loadSiteSnapshot(): Promise<AnalyticsSnapshot | null> {
  snapshotPromise ??= (async () => {
    try {
      const config = await loadAppConfig();
      if (!config.siteDataBase) return null;
      const response = await fetch(`${config.siteDataBase}/snapshot.json`, { cache: "no-cache" });
      return response.ok ? decodeSnapshot(await response.text()) : null;
    } catch {
      return null; // pages fall back to the in-browser database
    }
  })().then((snapshot) => {
    settledSnapshot = snapshot;
    return snapshot;
  });
  return snapshotPromise;
}

export function useSiteSnapshot(): { snapshot: AnalyticsSnapshot | null; settled: boolean } {
  const [loaded, setLoaded] = useState<AnalyticsSnapshot | null | undefined>(settledSnapshot);
  useEffect(() => {
    let cancelled = false;
    void loadSiteSnapshot().then((snapshot) => !cancelled && setLoaded(snapshot));
    return () => {
      cancelled = true;
    };
  }, []);
  const fresh = loaded && loaded.forDate === todayEastern() ? loaded : null; // made this morning for today's slate, otherwise the live database answers
  return { snapshot: fresh, settled: loaded !== undefined };
}

export function useSnapshotOrQuery<ResultType>(fromSnapshot: (snapshot: AnalyticsSnapshot) => ResultType | null, runner: ((handle: AnalyticsHandle) => Promise<ResultType>) | null, dependencyKey: string) {
  const { snapshot, settled } = useSiteSnapshot();
  const snapshotResult = snapshot && runner ? fromSnapshot(snapshot) : null;
  const useDatabase = settled && snapshotResult === null;
  const query = useAnalyticsQuery(useDatabase ? runner : null, `${dependencyKey}|${useDatabase ? "db" : "wait"}`); // the key changes when the database takes over, so the query runs
  if (snapshotResult !== null) return { result: snapshotResult, error: null, loading: false, status: query.status };
  return { ...query, loading: query.loading || !settled };
}
