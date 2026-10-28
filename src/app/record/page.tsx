"use client";

import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { LinesModelRecord } from "@/components/record/LinesModelRecord";
import { useAnalytics, useTracked } from "@/lib/client/hooks";
import { gradePendingPicks } from "@/lib/tracking/grader";
import { removeTracked, replaceTracked, saveGrades } from "@/lib/tracking/trackerStore";
import { calibrationBuckets, evBucket, groupBy, profitUnits, summarizeRecord, type TrackSource, type TrackedPick } from "@/lib/tracking/tracker";
import { UnitsChart } from "@/components/record/UnitsChart";
import { formatAmerican } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { todayEastern } from "@/lib/dates";
import { propMapping } from "@/lib/analytics/propTypes";
import { vendorLabel } from "@/lib/odds/deeplinks";

type SourceFilter = "all" | TrackSource;
type BreakdownName = "source" | "market" | "ev" | "calibration";

const sourceLabels: Record<string, string> = { halftime: "Halftime", live: "Live", "100-in-3": "100 in 3", lines: "Lines", slip: "Slip" };

function SummaryRow({ label, picks }: { label: string; picks: TrackedPick[] }) {
  const summary = summarizeRecord(picks);
  return (
    <tr>
      <td className="strong">{sourceLabels[label] ?? label}</td>
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
  const [breakdown, setBreakdown] = useState<BreakdownName>("source");

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
  const decidedInOrder = filtered.filter((pick) => pick.result && (pick.result.status === "win" || pick.result.status === "loss")).sort((first, second) => first.gameDate.localeCompare(second.gameDate) || first.createdAt.localeCompare(second.createdAt));
  const runningUnits: number[] = [];
  for (const pick of decidedInOrder) runningUnits.push((runningUnits[runningUnits.length - 1] ?? 0) + profitUnits(pick.result!.status, pick.americanOdds));
  const breakdownRows = breakdown === "source" ? [...bySource.entries()] : breakdown === "market" ? [...byMarket.entries()] : [...byEv.entries()];
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
          <p>
            Logged at the first price seen, graded from final stats · stored on this device ·{" "}
            <button className="link-button" onClick={exportRecord} disabled={tracked.length === 0}>
              Export
            </button>{" "}
            ·{" "}
            <label className="link-button">
              Import
              <input type="file" accept="application/json" hidden onChange={(changeEvent) => changeEvent.target.files?.[0] && importRecord(changeEvent.target.files[0])} />
            </label>
          </p>
        </div>
        <Segmented
          options={[
            { value: "all", label: "All" },
            { value: "lines", label: "Lines" },
            { value: "100-in-3", label: "100 in 3" },
            { value: "live", label: "Live" },
            { value: "halftime", label: "Halftime" },
            { value: "slip", label: "Slip" },
          ]}
          value={sourceFilter}
          onChange={setSourceFilter}
          label="Source"
        />
      </div>
      {gradeMessage ? <div className="notice info" style={{ marginBottom: 12 }}>{gradeMessage}</div> : null}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-value">
            {summary.wins}-{summary.losses}
            {summary.pushes > 0 ? `-${summary.pushes}` : ""}
          </div>
          <div className="kpi-label">{summary.pending} pending</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{formatPercent(summary.winRate, 1)}</div>
          <div className="kpi-label">Hit rate · model {formatPercent(summary.averageModelProbability, 1)}</div>
        </div>
        <div className="kpi">
          <div className={`kpi-value ${summary.unitsProfit >= 0 ? "positive" : "negative"}`}>{formatSigned(summary.unitsProfit, 2)}u</div>
          <div className="kpi-label">ROI {summary.roiPercent === null ? "-" : `${formatSigned(summary.roiPercent)}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{formatNumber(summary.brierScore, 3)}</div>
          <div className="kpi-label">Brier · 0.25 = coin flip</div>
        </div>
      </div>
      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-header">
          <h2>Units over time</h2>
          <span className="faint small">{runningUnits.length} graded picks</span>
        </div>
        <UnitsChart runningUnits={runningUnits} />
      </section>
      <div className="section-head">
        <Segmented
          options={[
            { value: "source", label: "Source" },
            { value: "market", label: "Market" },
            { value: "ev", label: "EV at pick" },
            { value: "calibration", label: "Calibration" },
          ]}
          value={breakdown}
          onChange={setBreakdown}
          label="Break down by"
        />
        {breakdown === "calibration" ? <span className="faint small">model chance vs. how often it hit</span> : null}
      </div>
      <section className="card flush">
        <div className="table-scroll" style={{ margin: 0, padding: 0 }}>
          {breakdown === "calibration" ? (
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
                    <td className="strong">{bucket.label}</td>
                    <td>{bucket.picks}</td>
                    <td>{formatPercent(bucket.predicted, 1)}</td>
                    <td className={bucket.actual !== null && bucket.predicted !== null ? (bucket.actual >= bucket.predicted ? "positive" : "negative") : ""}>{formatPercent(bucket.actual, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{breakdown === "source" ? "Source" : breakdown === "market" ? "Market" : "EV bucket"}</th>
                  <th>W-L</th>
                  <th>Hit</th>
                  <th>Units</th>
                  <th>ROI</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map(([groupLabel, picks]) => (
                  <SummaryRow key={groupLabel} label={groupLabel} picks={picks} />
                ))}
                {breakdownRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="faint">
                      Nothing tracked yet
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <LinesModelRecord handle={handle} />
      <section className="card flush" style={{ marginTop: 12 }}>
        <div className="card-header" style={{ padding: "14px 14px 0" }}>
          <h2>Picks</h2>
          <span className="faint small">latest {recent.length}</span>
        </div>
        {recent.length === 0 ? (
          <div className="empty-state">Nothing tracked yet. Flagged halftime picks, 100-in-3 projections and anything you add to the slip will show up here.</div>
        ) : (
          <div className="table-scroll" style={{ margin: 0, padding: 0 }}>
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
                    <td>{sourceLabels[pick.source] ?? pick.source}</td>
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
