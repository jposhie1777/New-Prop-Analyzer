import { readLocalJson, writeLocalJson } from "./safeStorage";

export interface EndpointUsage {
  requests: number;
  cdnHits: number;
  cdnMisses: number;
  staleServes: number;
  otherCache: number;
  bytes: number;
  functionDurationMsTotal: number;
}

export interface DeviceUsage {
  since: string;
  endpoints: Record<string, EndpointUsage>;
  dailyRequests: Record<string, number>;
  visibleMinutes: number;
}

const usageStorageKey = "pulse-nba-device-usage";

function emptyUsage(): DeviceUsage {
  return { since: new Date().toISOString(), endpoints: {}, dailyRequests: {}, visibleMinutes: 0 };
}

export function readDeviceUsage(): DeviceUsage {
  return readLocalJson<DeviceUsage>(usageStorageKey, emptyUsage());
}

export function resetDeviceUsage(): void {
  writeLocalJson(usageStorageKey, emptyUsage());
}

export function endpointGroup(requestPath: string): string {
  return requestPath.split("?")[0];
}

export function recordDeviceRequest(requestPath: string, cacheStatus: string | null, byteCount: number, functionDurationMs: number | null): void {
  const usage = readDeviceUsage();
  const group = endpointGroup(requestPath);
  const entry = usage.endpoints[group] ?? { requests: 0, cdnHits: 0, cdnMisses: 0, staleServes: 0, otherCache: 0, bytes: 0, functionDurationMsTotal: 0 };
  entry.requests += 1;
  entry.bytes += byteCount;
  const normalizedStatus = (cacheStatus ?? "").toUpperCase();
  if (normalizedStatus === "HIT") entry.cdnHits += 1;
  else if (normalizedStatus === "STALE") entry.staleServes += 1;
  else if (normalizedStatus === "MISS" || normalizedStatus === "BYPASS" || normalizedStatus === "") entry.cdnMisses += 1; // no header (local dev) counts as a function run
  else entry.otherCache += 1;
  if (functionDurationMs !== null && (normalizedStatus === "MISS" || normalizedStatus === "")) entry.functionDurationMsTotal += functionDurationMs;
  usage.endpoints[group] = entry;
  const todayKey = new Date().toISOString().slice(0, 10);
  usage.dailyRequests[todayKey] = (usage.dailyRequests[todayKey] ?? 0) + 1;
  writeLocalJson(usageStorageKey, usage);
}

export function recordVisibleMinute(): void {
  const usage = readDeviceUsage();
  usage.visibleMinutes += 1;
  writeLocalJson(usageStorageKey, usage);
}
