"use client";

import { useAnalytics } from "@/lib/client/hooks";

export function SyncStatus() {
  const { status } = useAnalytics();
  const dotClass = status.phase === "ready" ? "ready" : status.phase === "error" ? "error" : "";
  const label = status.phase === "ready" ? `Up to date${status.coveredThrough ? ` · thru ${status.coveredThrough.slice(5)}` : ""}` : status.phase === "error" ? "Sync error" : status.message;
  return (
    <span className="pill" title={status.error ?? status.message}>
      <span className={`sync-dot ${dotClass}`} />
      {label}
    </span>
  );
}
