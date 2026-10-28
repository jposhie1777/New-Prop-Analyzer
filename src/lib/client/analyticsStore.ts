"use client";

import { loadAppConfig, type AppConfig } from "./appConfig";
import { loadManifest, runTopUp } from "./topUp";
import { WasmAnalyticsEngine } from "./wasmEngine";
import { loadAnalyticsTables, loadDeferredTable, type LoadSources, type LoadSummary } from "@/lib/analytics/loadTables";
import type { TableName } from "@/lib/data/rowSchemas";
import type { AnalyticsEngine } from "@/lib/analytics/engine";
import type { BaselineManifest } from "@/lib/data/manifest";
import { todayEastern } from "@/lib/dates";

export type SyncPhase = "idle" | "starting" | "syncing" | "loading" | "ready" | "error";

export interface AnalyticsStatus {
  phase: SyncPhase;
  message: string;
  totalDates: number;
  completedDates: number;
  coveredThrough: string | null;
  topUpDates: number;
  summary: LoadSummary | null;
  error: string | null;
}

export interface AnalyticsHandle {
  engine: AnalyticsEngine;
  config: AppConfig;
  manifest: BaselineManifest | null;
  summary: LoadSummary;
  loadedForDate: string;
  version: number;
  ensureTable: (tableName: TableName) => Promise<void>; // fills a table left out of the first load, once

}

let currentStatus: AnalyticsStatus = { phase: "idle", message: "Not started", totalDates: 0, completedDates: 0, coveredThrough: null, topUpDates: 0, summary: null, error: null };
const statusListeners = new Set<(status: AnalyticsStatus) => void>();
let handlePromise: Promise<AnalyticsHandle> | null = null;
let enginePromise: Promise<WasmAnalyticsEngine> | null = null;
let loadVersion = 0;
const deferredTableNames: TableName[] = ["advanced_stats"]; // the biggest table, only the player page's usage card needs it

function publishStatus(update: Partial<AnalyticsStatus>): void {
  currentStatus = { ...currentStatus, ...update };
  for (const listener of statusListeners) listener(currentStatus);
}

export function analyticsStatus(): AnalyticsStatus {
  return currentStatus;
}

export function subscribeAnalyticsStatus(listener: (status: AnalyticsStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

async function buildHandle(): Promise<AnalyticsHandle> {
  publishStatus({ phase: "starting", message: "Starting analytics engine", error: null });
  const config = await loadAppConfig();
  enginePromise ??= WasmAnalyticsEngine.create();
  const [engine, bundledManifest, siteManifest] = await Promise.all([enginePromise, loadManifest(config.baselinePath), config.siteDataBase ? loadManifest(config.siteDataBase) : Promise.resolve(null)]);
  const useSiteData = Boolean(siteManifest?.lastDate && (!bundledManifest?.lastDate || siteManifest.lastDate >= bundledManifest.lastDate)); // the nightly copy, unless the bundled one is newer
  const manifest = useSiteData ? siteManifest : bundledManifest;
  const baselineBaseUrl = useSiteData ? config.siteDataBase! : config.baselinePath;
  const today = todayEastern();
  publishStatus({ phase: "syncing", message: "Checking for finished games" });
  const topUpPayloads = await runTopUp(config, manifest, today, (progress) => {
    publishStatus({ phase: "syncing", totalDates: progress.totalDates, completedDates: progress.completedDates, message: progress.totalDates > 0 ? `Syncing ${progress.completedDates}/${progress.totalDates} dates` : "Checking for finished games" });
  });
  publishStatus({ phase: "loading", message: "Loading data into DuckDB" });
  const sources: LoadSources = { manifest, baselineBaseUrl, topUpPayloads, deferredTables: deferredTableNames };
  const summary = await loadAnalyticsTables(engine, sources);
  const deferredLoads = new Map<TableName, Promise<void>>();
  const ensureTable = (tableName: TableName) => {
    if (!deferredTableNames.includes(tableName)) return Promise.resolve();
    if (!deferredLoads.has(tableName)) deferredLoads.set(tableName, loadDeferredTable(engine, sources, tableName).then(() => undefined, (caughtError) => {
      deferredLoads.delete(tableName); // try again next time
      throw caughtError;
    }));
    return deferredLoads.get(tableName)!;
  };
  for (const warning of summary.warnings) console.warn(`[pulse] ${warning}`); // visible in devtools, never blocks the page
  const coveredDates = [manifest?.lastDate ?? null, ...topUpPayloads.map((payload) => payload.date)].filter((coveredDate): coveredDate is string => Boolean(coveredDate)).sort();
  (window as unknown as { pulseQuery?: (sqlText: string) => Promise<unknown[]> }).pulseQuery = (sqlText: string) => engine.query(sqlText); // power-user hook: run SQL from devtools
  loadVersion += 1;
  publishStatus({ phase: "ready", message: "Up to date", coveredThrough: coveredDates.at(-1) ?? null, topUpDates: topUpPayloads.length, summary });
  return { engine, config, manifest, summary, loadedForDate: today, version: loadVersion, ensureTable };
}

export function getAnalytics(): Promise<AnalyticsHandle> {
  if (handlePromise) {
    return handlePromise.then((handle) => {
      if (handle.loadedForDate === todayEastern()) return handle;
      handlePromise = null; // the day rolled over: yesterday is final now, sync again
      return getAnalytics();
    });
  }
  handlePromise = buildHandle().catch((caughtError) => {
    handlePromise = null;
    publishStatus({ phase: "error", message: "Sync failed", error: caughtError instanceof Error ? caughtError.message : String(caughtError) });
    throw caughtError;
  });
  return handlePromise;
}
