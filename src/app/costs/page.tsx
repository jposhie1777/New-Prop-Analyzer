"use client";

import { useEffect, useState } from "react";
import { useAnalytics, useVisiblePolling } from "@/lib/client/hooks";
import { fetchApi } from "@/lib/client/apiClient";
import { readDeviceUsage, resetDeviceUsage, type DeviceUsage } from "@/lib/client/deviceUsage";
import { estimateFinalsBytes } from "@/lib/client/idbStore";
import { defaultWhatIf, projectUsage, type WhatIfInputs } from "@/lib/costs/costModel";
import { vercelHobbyLimits } from "@/config/vercelLimits";
import { goatMonthlyPriceUsd } from "@/config/tiers";
import { formatNumber, formatPercent } from "@/lib/client/format";
import type { UsageSnapshot } from "@/lib/server/usageCounters";

type ServerUsage = UsageSnapshot & { tier: string; tierLimitPerMinute: number };

function formatBytes(byteCount: number | null | undefined): string {
  if (byteCount === null || byteCount === undefined || !Number.isFinite(byteCount)) return "-";
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1_048_576) return `${(byteCount / 1024).toFixed(1)} KB`;
  return `${(byteCount / 1_048_576).toFixed(2)} MB`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

function LimitBar({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const share = limit > 0 ? used / limit : 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row-between small">
        <span>{label}</span>
        <span className={share > 1 ? "negative strong" : share > 0.7 ? "warning-text" : "muted"}>
          {formatCount(used)} / {formatCount(limit)} {unit} · {formatPercent(share, share < 0.01 ? 2 : 0)}
        </span>
      </div>
      <div className="meter">
        <span style={{ width: `${Math.min(100, share * 100)}%`, background: share > 1 ? "var(--negative)" : undefined }} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, step = 1, minimum = 0, maximum }: { label: string; value: number; onChange: (next: number) => void; step?: number; minimum?: number; maximum?: number }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="small muted">{label}</span>
      <input className="input" type="number" step={step} min={minimum} max={maximum} value={value} onChange={(changeEvent) => onChange(Number(changeEvent.target.value))} />
    </label>
  );
}

export default function CostsPage() {
  const server = useVisiblePolling(() => fetchApi<ServerUsage>("/api/usage", { cache: "no-store" }), 30_000, "usage");
  const { handle } = useAnalytics();
  const [device, setDevice] = useState<DeviceUsage | null>(null);
  const [indexedBytes, setIndexedBytes] = useState<number | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [whatIf, setWhatIf] = useState<WhatIfInputs>(defaultWhatIf);

  useEffect(() => {
    setDevice(readDeviceUsage());
    const timer = window.setInterval(() => setDevice(readDeviceUsage()), 10_000);
    estimateFinalsBytes().then(setIndexedBytes, () => setIndexedBytes(null));
    navigator.storage?.estimate?.().then(setStorageEstimate, () => setStorageEstimate(null));
    return () => window.clearInterval(timer);
  }, []);

  const deviceEndpoints = Object.entries(device?.endpoints ?? {}).sort(([, first], [, second]) => second.requests - first.requests);
  const deviceTotals = deviceEndpoints.reduce(
    (totals, [, entry]) => ({ requests: totals.requests + entry.requests, hits: totals.hits + entry.cdnHits, stale: totals.stale + entry.staleServes, misses: totals.misses + entry.cdnMisses, bytes: totals.bytes + entry.bytes, functionMs: totals.functionMs + entry.functionDurationMsTotal }),
    { requests: 0, hits: 0, stale: 0, misses: 0, bytes: 0, functionMs: 0 },
  );
  const cacheHitRate = deviceTotals.requests > 0 ? (deviceTotals.hits + deviceTotals.stale) / deviceTotals.requests : null;
  const measuredResponseKb = deviceTotals.requests > 0 ? deviceTotals.bytes / deviceTotals.requests / 1024 : null;
  const measuredFunctionMs = deviceTotals.misses > 0 && deviceTotals.functionMs > 0 ? deviceTotals.functionMs / deviceTotals.misses : null;
  const projection = projectUsage(whatIf);
  const serverRoutes = Object.entries(server.data?.routeInvocations ?? {}).sort(([, first], [, second]) => second.invocations - first.invocations);
  const serverEndpoints = Object.entries(server.data?.bdlCallsByEndpoint ?? {}).sort(([, first], [, second]) => second.calls - first.calls);
  const tierLimit = server.data?.tierLimitPerMinute ?? 600;
  const baselineBytes = handle?.manifest?.totalBytes ?? null;
  const updateWhatIf = (update: Partial<WhatIfInputs>) => setWhatIf((previous) => ({ ...previous, ...update }));

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Cost analyzer</h1>
          <p>Nothing runs unless this page is open. Server counters are per instance and approximate; device counters are exact for this browser.</p>
        </div>
      </div>

      <section className="card">
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">${formatNumber(goatMonthlyPriceUsd / 30.44, 2)}</div>
            <div className="kpi-label">BDL per day (GOAT ${goatMonthlyPriceUsd}/mo)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value positive">${formatNumber(projection.extraInfraCostUsd, 2)}</div>
            <div className="kpi-label">Extra infrastructure cost (Vercel Hobby, no DB, no cron)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{formatPercent(cacheHitRate, 0)}</div>
            <div className="kpi-label">CDN hit rate on this device ({formatCount(deviceTotals.stale)} stale serves)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">
              {server.data?.bdlPeakPerMinute ?? "-"}
              <span className="faint" style={{ fontSize: 14 }}> / {tierLimit}</span>
            </div>
            <div className="kpi-label">Peak BDL calls per minute vs {server.data?.tier ?? "tier"} limit (approx.)</div>
          </div>
        </div>
      </section>

      <div className="grid-two" style={{ marginTop: 12 }}>
        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>BDL calls by endpoint</h2>
            <span className="pill warning">approximate</span>
          </div>
          <p className="faint small" style={{ marginTop: 0 }}>{server.data?.note ?? "Loading server counters…"} Instance started {server.data ? new Date(server.data.instanceStartedAt).toLocaleString() : "-"} · {server.data?.bdlCallsLastMinute ?? 0} calls in the last minute.</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Calls</th>
                  <th>Retries</th>
                  <th>429s</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {serverEndpoints.map(([endpoint, entry]) => (
                  <tr key={endpoint}>
                    <td className="tabular">{endpoint}</td>
                    <td>{entry.calls}</td>
                    <td>{entry.retries}</td>
                    <td className={entry.rateLimited > 0 ? "negative" : ""}>{entry.rateLimited}</td>
                    <td>{entry.failures}</td>
                  </tr>
                ))}
                {serverEndpoints.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="faint">
                      No BDL calls on this instance yet (the CDN may be answering everything)
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}>
            <LimitBar label="Peak BDL calls in one minute" used={server.data?.bdlPeakPerMinute ?? 0} limit={tierLimit} unit="calls/min" />
          </div>
        </section>

        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>Vercel function invocations</h2>
            <span className="pill warning">approximate</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Runs</th>
                  <th>Avg ms</th>
                  <th>Max ms</th>
                </tr>
              </thead>
              <tbody>
                {serverRoutes.map(([routeName, entry]) => (
                  <tr key={routeName}>
                    <td>{routeName}</td>
                    <td>{entry.invocations}</td>
                    <td>{formatNumber(entry.totalDurationMs / Math.max(1, entry.invocations), 0)}</td>
                    <td>{entry.maxDurationMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>This device</h2>
            <button className="button small ghost" onClick={() => { resetDeviceUsage(); setDevice(readDeviceUsage()); }}>
              Reset
            </button>
          </div>
          <p className="faint small" style={{ marginTop: 0 }}>
            Since {device ? new Date(device.since).toLocaleDateString() : "-"} · {device?.visibleMinutes ?? 0} visible minutes · {formatCount(deviceTotals.requests)} requests · {formatBytes(deviceTotals.bytes)}
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Requests</th>
                  <th>CDN hit</th>
                  <th>Stale</th>
                  <th>Function runs</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {deviceEndpoints.map(([endpoint, entry]) => (
                  <tr key={endpoint}>
                    <td className="tabular">{endpoint}</td>
                    <td>{entry.requests}</td>
                    <td>{entry.cdnHits}</td>
                    <td>{entry.staleServes}</td>
                    <td>{entry.cdnMisses}</td>
                    <td>{formatBytes(entry.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint small">Function runs = responses without a CDN HIT/STALE header (in local dev every request runs the function).</p>
        </section>

        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>Storage</h2>
          </div>
          <div className="stack small">
            <div className="row-between">
              <span>Baseline Parquet (static files)</span>
              <span className="strong">{formatBytes(baselineBytes)}</span>
            </div>
            {Object.values(handle?.manifest?.seasons ?? {}).map((seasonEntry) => (
              <div key={seasonEntry.season} className="row-between faint">
                <span>
                  {seasonEntry.season}: {seasonEntry.dateCount} dates thru {seasonEntry.lastDate ?? "-"}
                </span>
                <span>{formatBytes(Object.values(seasonEntry.tables).reduce((runningTotal, tableFile) => runningTotal + (tableFile?.bytes ?? 0), 0))}</span>
              </div>
            ))}
            <div className="row-between">
              <span>IndexedDB top-up data</span>
              <span className="strong">{formatBytes(indexedBytes)}</span>
            </div>
            <div className="row-between">
              <span>Browser storage used / quota</span>
              <span>
                {formatBytes(storageEstimate?.usage)} / {formatBytes(storageEstimate?.quota)}
              </span>
            </div>
            <div className="row-between">
              <span>Rows loaded in DuckDB</span>
              <span>{formatCount(Object.values(handle?.summary.tableRowCounts ?? {}).reduce((runningTotal, rowCount) => runningTotal + rowCount, 0))}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-header wrap">
          <h2>What-if: projected monthly usage vs Vercel Hobby</h2>
          <span className={`pill ${projection.withinHobby ? "positive" : "negative"}`}>{projection.withinHobby ? "Within Hobby · $0" : "Over Hobby: project would pause, still $0"}</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginBottom: 14 }}>
          <NumberField label="Viewers" value={whatIf.viewers} onChange={(next) => updateWhatIf({ viewers: Math.max(0, next) })} />
          <NumberField label="Hours/day each" value={whatIf.hoursPerDay} step={0.5} onChange={(next) => updateWhatIf({ hoursPerDay: Math.min(24, Math.max(0, next)) })} />
          <NumberField label="Live poll (sec)" value={whatIf.livePollSeconds} onChange={(next) => updateWhatIf({ livePollSeconds: Math.max(5, next) })} />
          <NumberField label="Slate poll (min)" value={whatIf.slatePollMinutes} onChange={(next) => updateWhatIf({ slatePollMinutes: Math.max(1, next) })} />
          <NumberField label="Share of time live (0-1)" value={whatIf.liveShare} step={0.1} maximum={1} onChange={(next) => updateWhatIf({ liveShare: Math.min(1, Math.max(0, next)) })} />
          <NumberField label="Prop games open" value={whatIf.propGamesWatched} onChange={(next) => updateWhatIf({ propGamesWatched: Math.max(0, next) })} />
          <NumberField label="Avg response KB" value={Number(formatNumber(whatIf.averageResponseKb, 1))} step={1} onChange={(next) => updateWhatIf({ averageResponseKb: Math.max(0, next) })} />
          <NumberField label="Avg function ms" value={whatIf.averageFunctionMs} step={50} onChange={(next) => updateWhatIf({ averageFunctionMs: Math.max(0, next) })} />
          <label className="stack" style={{ gap: 4 }}>
            <span className="small muted">Viewers overlap?</span>
            <select className="input" value={whatIf.overlapping ? "yes" : "no"} onChange={(changeEvent) => updateWhatIf({ overlapping: changeEvent.target.value === "yes" })}>
              <option value="yes">Same time (shared cache)</option>
              <option value="no">Different times</option>
            </select>
          </label>
        </div>
        {measuredResponseKb !== null || measuredFunctionMs !== null ? (
          <button className="button small ghost" style={{ marginBottom: 12 }} onClick={() => updateWhatIf({ averageResponseKb: measuredResponseKb ?? whatIf.averageResponseKb, averageFunctionMs: measuredFunctionMs ?? whatIf.averageFunctionMs })}>
            Use this device&apos;s measured averages ({formatNumber(measuredResponseKb)} KB, {formatNumber(measuredFunctionMs, 0)} ms)
          </button>
        ) : null}
        <div className="stack" style={{ gap: 12 }}>
          <LimitBar label="Edge requests" used={projection.edgeRequests} limit={vercelHobbyLimits.edgeRequestsPerMonth} unit="/mo" />
          <LimitBar label="Function invocations" used={projection.functionInvocations} limit={vercelHobbyLimits.functionInvocationsPerMonth} unit="/mo" />
          <LimitBar label="Active CPU (hours)" used={projection.activeCpuHours} limit={vercelHobbyLimits.activeCpuHoursPerMonth} unit="h/mo" />
          <LimitBar label="Fast data transfer (GB)" used={projection.dataTransferGb} limit={vercelHobbyLimits.fastDataTransferGbPerMonth} unit="GB/mo" />
        </div>
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          <div className="kpi">
            <div className="kpi-value">{formatCount(projection.bdlCalls)}</div>
            <div className="kpi-label">BDL calls / month (flat price, no overage)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{projection.peakBdlPerMinute}</div>
            <div className="kpi-label">Est. peak BDL calls/min vs {tierLimit}</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">${formatNumber(projection.bdlCostPerDayUsd, 2)}</div>
            <div className="kpi-label">BDL per day</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">${formatNumber(projection.bdlCalls > 0 ? (goatMonthlyPriceUsd / projection.bdlCalls) * 1000 : 0, 2)}</div>
            <div className="kpi-label">BDL cost per 1,000 calls</div>
          </div>
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          {vercelHobbyLimits.verify}. Limits live in src/config/vercelLimits.ts. Function invocations only happen on CDN misses, so overlapping viewers share one fill per TTL.
        </p>
      </section>
    </main>
  );
}
