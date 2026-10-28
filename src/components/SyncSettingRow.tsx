"use client";

import { useSyncExternalStore } from "react";
import { cloudSyncStatus, pullCloudSync, subscribeCloudSync } from "@/lib/client/cloudSync";

const serverStatus = { status: "off" as const, lastSyncedAt: null };
let cachedStatus = cloudSyncStatus();

function statusSnapshot() {
  const latest = cloudSyncStatus();
  if (latest.status !== cachedStatus.status || latest.lastSyncedAt !== cachedStatus.lastSyncedAt) cachedStatus = latest; // a stable object until something changes
  return cachedStatus;
}

export function SyncSettingRow() {
  const { status, lastSyncedAt } = useSyncExternalStore(subscribeCloudSync, statusSnapshot, () => serverStatus);
  const label = status === "off" ? "Off" : status === "syncing" ? "Syncing…" : status === "error" ? "Could not reach the sync store" : `On · synced ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}`;
  return (
    <div className="setting-row">
      <div>
        <span className="strong">Sync across devices</span>
        <p>{status === "off" ? "Needs a SYNC_GITHUB_TOKEN in Vercel (see the README). Until then, the slip and sportsbooks stay on this device." : "Your slip and sportsbook settings follow you between your computer and phone."}</p>
      </div>
      <span className="row" style={{ gap: 8 }}>
        <span className={`pill${status === "synced" ? " positive" : status === "error" ? " negative" : ""}`}>{label}</span>
        {status !== "off" ? (
          <button className="button small ghost" onClick={() => void pullCloudSync()}>
            Sync now
          </button>
        ) : null}
      </span>
    </div>
  );
}
