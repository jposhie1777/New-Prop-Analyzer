"use client";

import { readSlip, replaceSlip, subscribeSlip, type SlipPick } from "./betSlip";
import { readSettings, saveSettings, subscribeSettings, type UserSettings } from "./settings";
import { readLocalJson, writeLocalJson } from "./safeStorage";
import { readPlacedBets, replacePlacedBets, subscribePlacedBets, type PlacedBet } from "./placedBets";
import type { SyncSectionName, SyncState } from "@/lib/sync/syncState";

export type CloudSyncStatus = "off" | "syncing" | "synced" | "error";

const syncedSettingKeys: Array<keyof UserSettings> = ["enabledBooks", "defaultBook", "sportsbookState", "evThresholdPercent", "wagerAmount", "pickType", "threeQuarterMinimumPercent", "threeQuarterMaxPicks"]; // appearance and layout stay per device
const stampsStorageKey = "pulse-nba-sync-stamps";
const pullIntervalMs = 30_000;

let started = false;
let applyingRemote = false;
let pushTimer: number | null = null;
let lastPullMs = 0;
let currentStatus: CloudSyncStatus = "off";
let lastSyncedAt: string | null = null;
const statusListeners = new Set<() => void>();

function setStatus(nextStatus: CloudSyncStatus): void {
  currentStatus = nextStatus;
  if (nextStatus === "synced") lastSyncedAt = new Date().toISOString();
  for (const listener of statusListeners) listener();
}

export function cloudSyncStatus(): { status: CloudSyncStatus; lastSyncedAt: string | null } {
  return { status: currentStatus, lastSyncedAt };
}

export function subscribeCloudSync(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function readStamps(): Partial<Record<SyncSectionName, string>> {
  return readLocalJson<Partial<Record<SyncSectionName, string>>>(stampsStorageKey, {});
}

function stamp(sectionName: SyncSectionName, updatedAt: string): void {
  writeLocalJson(stampsStorageKey, { ...readStamps(), [sectionName]: updatedAt });
}

function syncedSettings(settings: UserSettings): Record<string, unknown> {
  return Object.fromEntries(syncedSettingKeys.map((settingKey) => [settingKey, settings[settingKey]]));
}

function localSections(): Partial<SyncState> {
  const stamps = readStamps();
  return {
    slip: stamps.slip ? { value: readSlip(), updatedAt: stamps.slip } : null,
    settings: stamps.settings ? { value: syncedSettings(readSettings()), updatedAt: stamps.settings } : null,
    placed: stamps.placed ? { value: readPlacedBets(), updatedAt: stamps.placed } : null,
  };
}

function applyRemote(state: SyncState): void {
  const stamps = readStamps();
  applyingRemote = true;
  try {
    if (state.slip && (!stamps.slip || state.slip.updatedAt > stamps.slip)) {
      replaceSlip(state.slip.value as SlipPick[]);
      stamp("slip", state.slip.updatedAt);
    }
    if (state.placed && (!stamps.placed || state.placed.updatedAt > stamps.placed)) {
      replacePlacedBets(state.placed.value as PlacedBet[]);
      stamp("placed", state.placed.updatedAt);
    }
    if (state.settings && (!stamps.settings || state.settings.updatedAt > stamps.settings)) {
      const allowed = Object.fromEntries(Object.entries(state.settings.value).filter(([settingKey]) => syncedSettingKeys.includes(settingKey as keyof UserSettings)));
      saveSettings(allowed as Partial<UserSettings>);
      stamp("settings", state.settings.updatedAt);
    }
  } finally {
    applyingRemote = false;
  }
}

function needsPush(state: SyncState): boolean {
  const stamps = readStamps();
  return (["slip", "settings", "placed"] as const).some((sectionName) => {
    const localStamp = stamps[sectionName];
    const remote = state[sectionName];
    return Boolean(localStamp) && (!remote || localStamp! > remote.updatedAt);
  });
}

async function push(): Promise<void> {
  setStatus("syncing");
  try {
    const response = await fetch("/api/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localSections()) });
    const body = (await response.json()) as { enabled: boolean; state?: SyncState; error?: string };
    if (!body.enabled) return setStatus("off");
    if (!response.ok || !body.state) return setStatus("error");
    applyRemote(body.state); // another device may have saved something newer in the meantime
    setStatus("synced");
  } catch {
    setStatus("error");
  }
}

export async function pullCloudSync(): Promise<void> {
  lastPullMs = Date.now();
  if (currentStatus !== "off") setStatus("syncing");
  try {
    const response = await fetch("/api/sync", { cache: "no-store" });
    const body = (await response.json()) as { enabled: boolean; state?: SyncState; error?: string };
    if (!body.enabled) return setStatus("off");
    if (!response.ok || !body.state) return setStatus("error");
    applyRemote(body.state);
    const stamps = readStamps();
    const firstRunStamp = new Date().toISOString();
    if (!body.state.slip && !stamps.slip && readSlip().length > 0) stamp("slip", firstRunStamp); // the first device to sync uploads what it already has
    if (!body.state.settings && !stamps.settings) stamp("settings", firstRunStamp);
    if (!body.state.placed && !stamps.placed && readPlacedBets().length > 0) stamp("placed", firstRunStamp);
    if (needsPush(body.state)) await push(); // this device has changes the cloud has not seen
    else setStatus("synced");
  } catch {
    setStatus("error");
  }
}

function schedulePush(sectionName: SyncSectionName): void {
  if (applyingRemote) return;
  stamp(sectionName, new Date().toISOString());
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void push();
  }, 1200); // a burst of taps becomes one save
}

export function startCloudSync(): () => void {
  if (started) return () => undefined;
  started = true;
  let lastSettingsText = JSON.stringify(syncedSettings(readSettings()));
  const stopSlip = subscribeSlip(() => schedulePush("slip"));
  const stopPlaced = subscribePlacedBets(() => schedulePush("placed"));
  const stopSettings = subscribeSettings((settings) => {
    const settingsText = JSON.stringify(syncedSettings(settings));
    if (settingsText === lastSettingsText) return; // only changes to synced settings count
    lastSettingsText = settingsText;
    schedulePush("settings");
  });
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - lastPullMs > pullIntervalMs) void pullCloudSync(); // picks up what the other device saved
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  void pullCloudSync();
  return () => {
    started = false;
    stopSlip();
    stopPlaced();
    stopSettings();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
