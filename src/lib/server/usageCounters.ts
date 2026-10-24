export interface EndpointCounter {
  calls: number;
  retries: number;
  rateLimited: number;
  failures: number;
}

export interface RouteCounter {
  invocations: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export interface UsageSnapshot {
  approximate: true;
  note: string;
  instanceStartedAt: string;
  bdlCallsTotal: number;
  bdlCallsByEndpoint: Record<string, EndpointCounter>;
  bdlPeakPerMinute: number;
  bdlCallsLastMinute: number;
  routeInvocations: Record<string, RouteCounter>;
}

interface CounterStore {
  startedAt: number;
  endpoints: Map<string, EndpointCounter>;
  minuteBuckets: Map<number, number>; // epoch minute -> BDL calls
  peakPerMinute: number;
  routes: Map<string, RouteCounter>;
}

const globalHolder = globalThis as unknown as { pulseUsageCounters?: CounterStore };

function counterStore(): CounterStore {
  if (!globalHolder.pulseUsageCounters) {
    globalHolder.pulseUsageCounters = { startedAt: Date.now(), endpoints: new Map(), minuteBuckets: new Map(), peakPerMinute: 0, routes: new Map() };
  }
  return globalHolder.pulseUsageCounters;
}

export function endpointLabel(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, "/{id}"); // collapse ids so counts group by endpoint
}

function endpointEntry(path: string): EndpointCounter {
  const store = counterStore();
  const label = endpointLabel(path);
  let entry = store.endpoints.get(label);
  if (!entry) {
    entry = { calls: 0, retries: 0, rateLimited: 0, failures: 0 };
    store.endpoints.set(label, entry);
  }
  return entry;
}

export function recordBdlCall(path: string, nowMs = Date.now()): void {
  const store = counterStore();
  endpointEntry(path).calls += 1;
  const minuteKey = Math.floor(nowMs / 60_000);
  const minuteCount = (store.minuteBuckets.get(minuteKey) ?? 0) + 1;
  store.minuteBuckets.set(minuteKey, minuteCount);
  store.peakPerMinute = Math.max(store.peakPerMinute, minuteCount);
  for (const bucketMinute of store.minuteBuckets.keys()) if (bucketMinute < minuteKey - 60) store.minuteBuckets.delete(bucketMinute); // keep one hour
}

export function recordBdlRetry(path: string, wasRateLimited: boolean): void {
  const entry = endpointEntry(path);
  entry.retries += 1;
  if (wasRateLimited) entry.rateLimited += 1;
}

export function recordBdlFailure(path: string): void {
  endpointEntry(path).failures += 1;
}

export function recordRouteInvocation(routeName: string, durationMs: number): void {
  const store = counterStore();
  let entry = store.routes.get(routeName);
  if (!entry) {
    entry = { invocations: 0, totalDurationMs: 0, maxDurationMs: 0 };
    store.routes.set(routeName, entry);
  }
  entry.invocations += 1;
  entry.totalDurationMs += durationMs;
  entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
}

export function usageSnapshot(nowMs = Date.now()): UsageSnapshot {
  const store = counterStore();
  const bdlCallsTotal = [...store.endpoints.values()].reduce((runningTotal, entry) => runningTotal + entry.calls, 0);
  return {
    approximate: true,
    note: "In-memory counters for this server instance only. Serverless instances restart and run in parallel, so treat these as approximate.",
    instanceStartedAt: new Date(store.startedAt).toISOString(),
    bdlCallsTotal,
    bdlCallsByEndpoint: Object.fromEntries(store.endpoints),
    bdlPeakPerMinute: store.peakPerMinute,
    bdlCallsLastMinute: store.minuteBuckets.get(Math.floor(nowMs / 60_000)) ?? 0,
    routeInvocations: Object.fromEntries(store.routes),
  };
}

export function resetUsageCounters(): void {
  globalHolder.pulseUsageCounters = undefined;
}
