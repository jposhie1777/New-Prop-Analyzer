"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { analyticsStatus, getAnalytics, subscribeAnalyticsStatus, type AnalyticsHandle, type AnalyticsStatus } from "./analyticsStore";
import { readSettings, subscribeSettings, type UserSettings, defaultSettings } from "./settings";
import { readSlip, subscribeSlip, type SlipPick } from "./betSlip";
import { recordVisibleMinute } from "./deviceUsage";
import { readTracked, subscribeTracked } from "@/lib/tracking/trackerStore";
import type { TrackedPick } from "@/lib/tracking/tracker";

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

export interface PolledData<DataType> {
  data: DataType | null;
  error: string | null;
  loading: boolean;
  lastUpdated: number | null;
  refresh: () => void;
}

export function useVisiblePolling<DataType>(loader: (() => Promise<DataType>) | null, intervalMs: number | null, dependencyKey: string): PolledData<DataType> {
  const visible = usePageVisible();
  const [state, setState] = useState<{ data: DataType | null; error: string | null; loading: boolean; lastUpdated: number | null }>({ data: null, error: null, loading: Boolean(loader), lastUpdated: null });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (!loaderRef.current) return;
    let cancelled = false;
    const runLoad = async () => {
      const activeLoader = loaderRef.current;
      if (!activeLoader) return;
      setState((previous) => ({ ...previous, loading: true }));
      try {
        const loaded = await activeLoader();
        if (!cancelled) setState({ data: loaded, error: null, loading: false, lastUpdated: Date.now() });
      } catch (caughtError) {
        if (!cancelled) setState((previous) => ({ ...previous, error: caughtError instanceof Error ? caughtError.message : String(caughtError), loading: false }));
      }
    };
    if (!visible) return; // hidden tab: no requests at all
    runLoad();
    const timer = intervalMs ? window.setInterval(runLoad, intervalMs) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [visible, intervalMs, dependencyKey, refreshCounter]);

  const refresh = useCallback(() => setRefreshCounter((count) => count + 1), []);
  return { ...state, refresh };
}

export function useAnalytics(): { handle: AnalyticsHandle | null; status: AnalyticsStatus } {
  const status = useSyncExternalStore(subscribeAnalyticsStatus, analyticsStatus, analyticsStatus);
  const [handle, setHandle] = useState<AnalyticsHandle | null>(null);
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getAnalytics().then(
      (loadedHandle) => {
        if (!cancelled) setHandle((previous) => (previous?.version === loadedHandle.version ? previous : loadedHandle));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [visible]); // re-checks after the tab comes back, which also catches a new day
  return { handle, status };
}

export function useAnalyticsQuery<ResultType>(runner: ((handle: AnalyticsHandle) => Promise<ResultType>) | null, dependencyKey: string): { result: ResultType | null; error: string | null; loading: boolean; status: AnalyticsStatus } {
  const { handle, status } = useAnalytics();
  const [state, setState] = useState<{ result: ResultType | null; error: string | null; loading: boolean }>({ result: null, error: null, loading: true });
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  useEffect(() => {
    if (!handle || !runnerRef.current) return;
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    runnerRef.current(handle).then(
      (result) => !cancelled && setState({ result, error: null, loading: false }),
      (caughtError) => {
        console.warn(`[pulse] query ${dependencyKey} failed`, caughtError); // surfaced in devtools for debugging
        if (!cancelled) setState({ result: null, error: caughtError instanceof Error ? caughtError.message : String(caughtError), loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [handle, dependencyKey]);
  return { ...state, loading: state.loading || !handle, status };
}

const serverDefaults = defaultSettings();

export function useSettings(): UserSettings {
  return useSyncExternalStore(
    (onChange) => subscribeSettings(onChange),
    () => settingsSnapshot(),
    () => serverDefaults,
  );
}

let cachedSettingsJson = "";
let cachedSettings: UserSettings = serverDefaults;
function settingsSnapshot(): UserSettings {
  const current = readSettings();
  const currentJson = JSON.stringify(current);
  if (currentJson !== cachedSettingsJson) {
    cachedSettingsJson = currentJson;
    cachedSettings = current;
  }
  return cachedSettings; // stable reference so React does not loop
}

let cachedSlipJson = "";
let cachedSlip: SlipPick[] = [];
const emptySlip: SlipPick[] = [];
function slipSnapshot(): SlipPick[] {
  const current = readSlip();
  const currentJson = JSON.stringify(current);
  if (currentJson !== cachedSlipJson) {
    cachedSlipJson = currentJson;
    cachedSlip = current;
  }
  return cachedSlip;
}

export function useSlip(): SlipPick[] {
  return useSyncExternalStore((onChange) => subscribeSlip(onChange), slipSnapshot, () => emptySlip);
}

export function useVisibleMinuteCounter(): void {
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(recordVisibleMinute, 60_000);
    return () => window.clearInterval(timer);
  }, [visible]);
}

let cachedTrackedJson = "";
let cachedTracked: TrackedPick[] = [];
const emptyTracked: TrackedPick[] = [];
function trackedSnapshot(): TrackedPick[] {
  const current = readTracked();
  const currentJson = JSON.stringify(current);
  if (currentJson !== cachedTrackedJson) {
    cachedTrackedJson = currentJson;
    cachedTracked = current;
  }
  return cachedTracked;
}

export function useTracked(): TrackedPick[] {
  return useSyncExternalStore((onChange) => subscribeTracked(onChange), trackedSnapshot, () => emptyTracked);
}
