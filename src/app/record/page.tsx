"use client";

import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { LinesModelRecord } from "@/components/record/LinesModelRecord";
import { useAnalytics, useTracked } from "@/lib/client/hooks";
import { gradePendingPicks } from "@/lib/tracking/grader";
import { removeTracked, replaceTracked, saveGrades } from "@/lib/tracking/trackerStore";
import { calibrationBuckets, evBucket, groupBy, summarizeRecord, type TrackSource, type TrackedPick } from "@/lib/tracking/tracker";
import { formatAmerican } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { todayEastern } from "@/lib/dates";
import { propMapping } from "@/lib/analytics/propTypes";
import { vendorLabel } from "@/lib/odds/deeplinks";

type SourceFilter = "all" | TrackSource;

function SummaryRow({ label, picks }: { label: string; picks: TrackedPick[] }) {
  const summary = summarizeRecord(picks);
  return (
    <tr>
      <td>{label}</td>
      <td>
        {summary.wins}-{summary.losses}
        {summary.pushes > 0 ? `-${summary.pushes}` : ""}
      </td>
      <td>{formatPercent(summary.winRate, 1)}</td>
      <td className={summary.unitsProfit >= 0 ? "positive" : "negative"}>{formatSigned(summary.unitsProfit, 2)}u</td>
      <td>{summary.roiPercent === null ? "-" : `${formatSigned(summary.roiPercent)}%`}</td>
      <td>{summary.pending}</td>
    </tr>
  );
}

export default function RecordPage() {
  const tracked = useTracked();
  const { handle } = useAnalytics();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [gradeMessage, setGradeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    gradePendingPicks(handle.engine, tracked, todayEastern()).then(
      (graded) => {
        if (cancelled || graded.length === 0) return;
        saveGrades(graded);
        setGradeMessage(`Graded ${graded.length} pick${graded.length === 1 ? "" : "s"} from final box scores.`);
      },
      (caughtError) => !cancelled && setGradeMessage(`Grading failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`),
    );
    return () => {
      cancelled = true;
    };
  }, [handle, tracked.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownPicks = useMemo(() => tracked.filter((pick) => pick.source !== "model" && pick.source !== "learned"), [tracked]); // the Lines model's every-game record has its own section
  const filtered = useMemo(() => (sourceFilter === "all" ? ownPicks : ownPicks.filter((pick) => pick.source === sourceFilter)), [ownPicks, sourceFilter]);
  const summary = summarizeRecord(filtered);
  const bySource = groupBy(ownPicks, (pick) => pick.source);
  const byMarket = groupBy(filtered, (pick) => (pick.kind === "prop" ? (propMapping(pick.propType ?? "")?.label ?? pick.propType ?? "prop") : pick.kind === "team_three_quarters" ? "100 in 3" : pick.kind));
  const byEv = groupBy(filtered.filter((pick) => pick.americanOdds !== null), (pick) => evBucket(pick.evPercent));
  const calibration = calibrationBuckets(filtered);
  const recent = [...filtered].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, 150);

  const exportRecord = () => {
    const blob = new Blob([JSON.stringify(tracked, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pulse-nba-record-${todayEastern()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importRecord = async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as TrackedPick[];
      if (!Array.isArray(imported)) throw new Error("not a list of picks");
      const merged = new Map(tracked.map((pick) => [pick.trackId, pick]));
      for (const pick of imported) if (pick && typeof pick.trackId === "string") merged.set(pick.trackId, pick);
      replaceTracked([...merged.values()]);
      setGradeMessage(`Imported ${imported.length} picks.`);
    } catch (caughtError) {
      setGradeMessage(`Import failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`);
    }
  };

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Record</h1>
          <p>Every flagged halftime or live pick, pregame 100-in-3 projection and bet-slip pick is logged at the price first seen, then graded from final stats once the game syncs. Stored on this device; export to keep a backup.</p>
        </div>
        <div className="row wrap">
          <button className="button ghost" onClick={exportRecord} disabled={tracked.length === 0}>
            Export
          </button>
          <label className="button ghost">
            Import
            <input type="file" accept="application/json" hidden onChange={(changeEvent) => changeEvent.target.files?.[0] && importRecord(changeEvent.target.files[0])} />
          </label>
        </div>
      </div>
      {gradeMessage ? <div className="notice info" style={{ marginBottom: 12 }}>{gradeMessage}</div> : null}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={[
            { value: "all", label: "All" },
            { value: "halftime", label: "Halftime" },
            { value: "live", label: "Live" },
            { value: "100-in-3", label: "100 in 3" },
            { value: "lines", label: "Lines" },
            { value: "slip", label: "Slip" },
          ]}
          value={sourceFilter}
          onChange={setSourceFilter}
          label="Source"
        />
      </div>
      <section className="card">
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">
              {summary.wins}-{summary.losses}
              {summary.pushes > 0 ? `-${summary.pushes}` : ""}
            </div>
            <div className="kpi-label">W-L{summary.pushes > 0 ? "-P" : ""} · {summary.pending} pending</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{formatPercent(summary.winRate, 1)}</div>
            <div className="kpi-label">Hit rate · model avg {formatPercent(summary.averageModelProbability, 1)}</div>
          </div>
          <div className="kpi">
            <div className={`kpi-value ${summary.unitsProfit >= 0 ? "positive" : "negative"}`}>{formatSigned(summary.unitsProfit, 2)}u</div>
            <div className="kpi-label">Profit at logged prices · ROI {summary.roiPercent === null ? "-" : `${formatSigned(summary.roiPercent)}%`}</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{formatNumber(summary.brierScore, 3)}</div>
            <div className="kpi-label">Brier score (lower is better, 0.25 = coin flip)</div>
          </div>
        </div>
      </section>
      <div className="grid-two" style={{ marginTop: 12 }}>
        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>By source</h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>W-L</th>
                  <th>Hit</th>
                  <th>Units</th>
                  <th>ROI</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {[...bySource.entries()].map(([source, picks]) => (
                  <SummaryRow key={source} label={source} picks={picks} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>Calibration</h2>
            <span className="faint small">model chance vs how often it hit</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model chance</th>
                  <th>Picks</th>
                  <th>Predicted</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((bucket) => (
                  <tr key={bucket.label}>
                    <td>{bucket.label}</td>
                    <td>{bucket.picks}</td>
                    <td>{formatPercent(bucket.predicted, 1)}</td>
                    <td className={bucket.actual !== null && bucket.predicted !== null ? (bucket.actual >= bucket.predicted ? "positive" : "negative") : ""}>{formatPercent(bucket.actual, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>By market</h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>W-L</th>
                  <th>Hit</th>
                  <th>Units</th>
                  <th>ROI</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {[...byMarket.entries()].map(([market, picks]) => (
                  <SummaryRow key={market} label={market} picks={picks} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" style={{ marginTop: 0 }}>
          <div className="card-header">
            <h2>By EV at pick time</h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>EV bucket</th>
                  <th>W-L</th>
                  <th>Hit</th>
                  <th>Units</th>
                  <th>ROI</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {[...byEv.entries()].map(([bucket, picks]) => (
                  <SummaryRow key={bucket} label={bucket} picks={picks} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <LinesModelRecord handle={handle} />
      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-header">
          <h2>Picks</h2>
          <span className="faint small">latest {recent.length}</span>
        </div>
        {recent.length === 0 ? (
          <div className="empty-state">Nothing tracked yet. Flagged halftime picks, 100-in-3 projections and anything you add to the slip will show up here.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pick</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Price</th>
                  <th>Model</th>
                  <th>EV</th>
                  <th>Actual</th>
                  <th>Result</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((pick) => (
                  <tr key={pick.trackId}>
                    <td>{pick.label}</td>
                    <td className="tabular">{pick.gameDate.slice(5)}</td>
                    <td>{pick.source}</td>
                    <td>
                      {formatAmerican(pick.americanOdds)} <span className="sub">{pick.vendor ? vendorLabel(pick.vendor) : ""}</span>
                    </td>
                    <td>{formatPercent(pick.modelProbability, 0)}</td>
                    <td>{pick.evPercent === null ? "-" : `${formatSigned(pick.evPercent)}%`}</td>
                    <td>{pick.result?.actual ?? "-"}</td>
                    <td>
                      {pick.result ? <span className={`pill ${pick.result.status === "win" ? "positive" : pick.result.status === "loss" ? "negative" : ""}`}>{pick.result.status}</span> : <span className="pill">pending</span>}
                    </td>
                    <td>
                      <button className="button small ghost" onClick={() => removeTracked([pick.trackId])} title="Remove from record">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
