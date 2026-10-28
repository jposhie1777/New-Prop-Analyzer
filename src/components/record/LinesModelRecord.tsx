"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { useSettings } from "@/lib/client/hooks";
import { summarizeRecord, type RecordSummary, type TrackedPick } from "@/lib/tracking/tracker";
import { dailyRecords, inRecordWindow, minimumGradedForVerdict, modelMarketLabels, modelMarkets, projectionAccuracy, recordWindowLabels, strengthsAndWeaknesses, tagRecords, type ModelMarket, type RecordWindow, type Verdict } from "@/lib/tracking/modelRecord";
import { backtestSeason, type BacktestProgress } from "@/lib/client/lineModel";
import { trackPicks } from "@/lib/tracking/trackerStore";
import type { AnalyticsHandle } from "@/lib/client/analyticsStore";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { appSettings } from "@/config/appSettings";
import { todayEastern } from "@/lib/dates";

const recordWindows: RecordWindow[] = ["season", "last30", "last7"];

function RecordCell({ summary }: { summary: RecordSummary }) {
  if (summary.wins + summary.losses + summary.pushes === 0) return <span className="faint">{summary.pending > 0 ? `${summary.pending} pending` : "–"}</span>;
  return (
    <span className="record-cell">
      <span className="strong">
        {summary.wins}-{summary.losses}
        {summary.pushes > 0 ? `-${summary.pushes}` : ""}
      </span>
      <span className="faint"> {formatPercent(summary.winRate, 0)}</span>
      <span className={`record-units ${summary.unitsProfit >= 0 ? "positive" : "negative"}`}>{formatSigned(summary.unitsProfit, 1)}u</span>
    </span>
  );
}

function VerdictLine({ verdict }: { verdict: Verdict }) {
  const { summary } = verdict;
  return (
    <li>
      <span className="strong">
        {modelMarketLabels[verdict.market]}
        {verdict.tag ? ` · ${verdict.tag}` : " overall"}
      </span>
      <span className="faint">
        {" "}
        {summary.wins}-{summary.losses} ({formatPercent(summary.winRate, 0)}), {formatSigned(summary.unitsProfit, 1)}u, ROI {formatSigned(summary.roiPercent ?? 0, 0)}%
      </span>
    </li>
  );
}

export function LinesModelRecord({ tracked, handle }: { tracked: TrackedPick[]; handle: AnalyticsHandle | null }) {
  const settings = useSettings();
  const [includeBacktest, setIncludeBacktest] = useState<"all" | "live">("all");
  const [breakdownMarket, setBreakdownMarket] = useState<ModelMarket>("spread");
  const [breakdownWindow, setBreakdownWindow] = useState<RecordWindow>("season");
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [backtestMessage, setBacktestMessage] = useState<string | null>(null);
  const today = todayEastern();
  const season = appSettings.currentSeason;
  const modelPicks = tracked.filter((pick) => pick.source === "model" && (includeBacktest === "all" || !(pick.tags ?? []).includes("Backtest")));
  const seasonPicks = modelPicks.filter((pick) => inRecordWindow(pick, "season", today, season));
  const verdicts = strengthsAndWeaknesses(seasonPicks);
  const breakdownPicks = modelPicks.filter((pick) => pick.kind === breakdownMarket && inRecordWindow(pick, breakdownWindow, today, season));
  const days = dailyRecords(modelPicks.filter((pick) => pick.gameDate < today), 14);
  const liveCount = tracked.filter((pick) => pick.source === "model" && !(pick.tags ?? []).includes("Backtest")).length;

  const runBacktest = async () => {
    if (!handle) return;
    setBacktestMessage(null);
    try {
      const knownIds = new Set(tracked.map((pick) => pick.trackId));
      const picks = await backtestSeason(handle.engine, season, settings.evThresholdPercent, knownIds, setProgress);
      const added = trackPicks(picks);
      setBacktestMessage(added > 0 ? `Backtested ${added} model picks. They are graded below and tagged "Backtest".` : "Nothing new to backtest: every finished game this season is already in the record.");
    } catch (caughtError) {
      setBacktestMessage(`Backtest failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="card-header wrap">
        <div>
          <h2>Lines model</h2>
          <div className="faint small">The model&apos;s side in every game, one pick per market, at the last line seen before tip-off. 1 unit flat.</div>
        </div>
        <Segmented
          options={[
            { value: "all", label: "Live + backtest" },
            { value: "live", label: "Live only" },
          ]}
          value={includeBacktest}
          onChange={setIncludeBacktest}
          label="Include backtest"
        />
      </div>

      <div className="table-scroll">
        <table className="data-table record-table">
          <thead>
            <tr>
              <th>Market</th>
              {recordWindows.map((recordWindow) => (
                <th key={recordWindow}>{recordWindowLabels[recordWindow]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...modelMarkets, "all" as const].map((market) => {
              const marketPicks = market === "all" ? modelPicks : modelPicks.filter((pick) => pick.kind === market);
              return (
                <tr key={market}>
                  <td className="strong">{market === "all" ? "All" : modelMarketLabels[market]}</td>
                  {recordWindows.map((recordWindow) => (
                    <td key={recordWindow}>
                      <RecordCell summary={summarizeRecord(marketPicks.filter((pick) => inRecordWindow(pick, recordWindow, today, season)))} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Projection miss (season)</th>
              <th>Model</th>
              <th>Market</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {(["spread", "total"] as const).map((market) => {
              const accuracy = projectionAccuracy(seasonPicks.filter((pick) => pick.kind === market), market);
              const modelBetter = accuracy.modelError !== null && accuracy.marketError !== null && accuracy.modelError < accuracy.marketError;
              return (
                <tr key={market}>
                  <td>{market === "spread" ? "Margin" : "Total points"}</td>
                  <td className={accuracy.modelError === null ? "" : modelBetter ? "positive" : "negative"}>{accuracy.modelError === null ? "–" : `${formatNumber(accuracy.modelError, 1)} pts`}</td>
                  <td>{accuracy.marketError === null ? "–" : `${formatNumber(accuracy.marketError, 1)} pts`}</td>
                  <td>{accuracy.games}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint small">Average miss of the projected margin and total vs. the final score, next to the consensus line it was compared against. Green = the model was closer than the books.</p>

      <div className="verdicts">
        <div>
          <div className="section-label positive">Strengths</div>
          {verdicts.strengths.length > 0 ? (
            <ul className="verdict-list">
              {verdicts.strengths.map((verdict) => (
                <VerdictLine key={`${verdict.market}-${verdict.tag}`} verdict={verdict} />
              ))}
            </ul>
          ) : (
            <p className="faint small">None yet (a group needs {minimumGradedForVerdict}+ decided picks and +5% ROI).</p>
          )}
        </div>
        <div>
          <div className="section-label negative">Weaknesses</div>
          {verdicts.weaknesses.length > 0 ? (
            <ul className="verdict-list">
              {verdicts.weaknesses.map((verdict) => (
                <VerdictLine key={`${verdict.market}-${verdict.tag}`} verdict={verdict} />
              ))}
            </ul>
          ) : (
            <p className="faint small">None yet (a group needs {minimumGradedForVerdict}+ decided picks and -5% ROI).</p>
          )}
        </div>
      </div>

      <div className="card-header wrap" style={{ marginTop: 14 }}>
        <h3>By situation</h3>
        <div className="row wrap" style={{ gap: 6 }}>
          <Segmented options={modelMarkets.map((market) => ({ value: market, label: modelMarketLabels[market] }))} value={breakdownMarket} onChange={setBreakdownMarket} label="Market" />
          <Segmented options={recordWindows.map((recordWindow) => ({ value: recordWindow, label: recordWindow === "season" ? "Season" : recordWindow === "last30" ? "L30d" : "L7d" }))} value={breakdownWindow} onChange={setBreakdownWindow} label="Window" />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Situation</th>
              <th>W-L</th>
              <th>Hit</th>
              <th>Units</th>
              <th>ROI</th>
            </tr>
          </thead>
          <tbody>
            {tagRecords(breakdownPicks).map(({ tag, summary }) => {
              const decided = summary.wins + summary.losses;
              const tone = decided >= minimumGradedForVerdict && summary.roiPercent !== null ? (summary.roiPercent >= 5 ? "positive" : summary.roiPercent <= -5 ? "negative" : "") : "faint";
              return (
                <tr key={tag}>
                  <td>{tag}</td>
                  <td>
                    {summary.wins}-{summary.losses}
                    {summary.pushes > 0 ? `-${summary.pushes}` : ""}
                  </td>
                  <td>{formatPercent(summary.winRate, 0)}</td>
                  <td className={summary.unitsProfit >= 0 ? "positive" : "negative"}>{formatSigned(summary.unitsProfit, 1)}</td>
                  <td className={tone}>{summary.roiPercent === null ? "–" : `${formatSigned(summary.roiPercent, 0)}%`}</td>
                </tr>
              );
            })}
            {breakdownPicks.length === 0 ? (
              <tr>
                <td colSpan={5} className="faint">
                  No picks in this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: "14px 0 6px", fontSize: 15 }}>Daily</h3>
      <div className="table-scroll">
        <table className="data-table record-table">
          <thead>
            <tr>
              <th>Date</th>
              {modelMarkets.map((market) => (
                <th key={market}>{modelMarketLabels[market]}</th>
              ))}
              <th>Day</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{day.date.slice(5)}</td>
                {modelMarkets.map((market) => (
                  <td key={market}>
                    <RecordCell summary={day.byMarket[market]} />
                  </td>
                ))}
                <td className={day.total.unitsProfit >= 0 ? "positive" : "negative"}>{day.total.wins + day.total.losses > 0 ? `${formatSigned(day.total.unitsProfit, 1)}u` : "–"}</td>
              </tr>
            ))}
            {days.length === 0 ? (
              <tr>
                <td colSpan={5} className="faint">
                  No finished days yet. Open the Slate or Lines tab on game days and the model&apos;s picks are saved automatically.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="backtest-box">
        <div className="small">
          <span className="strong">Backtest this season.</span> Runs the model on every finished game using only data from before that day, against that day&apos;s opening lines (no past injury reports). {liveCount} live pick{liveCount === 1 ? "" : "s"} so far.
        </div>
        <button className="button" onClick={runBacktest} disabled={!handle || progress !== null}>
          {progress ? `Backtesting ${progress.completedDates}/${progress.totalDates} days…` : "Run backtest"}
        </button>
        {backtestMessage ? <div className="faint small">{backtestMessage}</div> : null}
      </div>
    </section>
  );
}
