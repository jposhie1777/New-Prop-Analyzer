"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { useNcaabRecord } from "@/lib/client/ncaabData";
import { confidenceLevels, confidenceTag, confidenceTiers } from "@/lib/analytics/confidence";
import { summarizeRecord, type RecordSummary, type TrackedPick } from "@/lib/tracking/tracker";
import { modelMarketLabels, modelMarkets } from "@/lib/tracking/modelRecord";
import { addDays, todayEastern } from "@/lib/dates";
import { formatAmerican } from "@/lib/math/odds";
import { formatPercent, formatSigned } from "@/lib/client/format";

type RecordWindow = "season" | "last30" | "last7";

function SummaryRow({ label, summary }: { label: string; summary: RecordSummary }) {
  return (
    <tr>
      <td className="strong">{label}</td>
      <td>
        {summary.wins}-{summary.losses}
        {summary.pushes > 0 ? `-${summary.pushes}` : ""}
      </td>
      <td>{formatPercent(summary.winRate, 1)}</td>
      <td className={summary.unitsProfit >= 0 ? "positive" : "negative"}>{formatSigned(summary.unitsProfit, 2)}u</td>
      <td>{summary.roiPercent === null ? "-" : `${formatSigned(summary.roiPercent, 1)}%`}</td>
      <td>{summary.pending}</td>
    </tr>
  );
}

const statusPill: Record<string, string> = { win: "positive", loss: "negative", push: "", void: "" };

export default function NcaabRecordPage() {
  const record = useNcaabRecord();
  const [recordWindow, setRecordWindow] = useState<RecordWindow>("season");
  const today = todayEastern();
  const since = recordWindow === "last7" ? addDays(today, -7) : recordWindow === "last30" ? addDays(today, -30) : "0000-00-00";
  const picks = (record.data?.picks ?? []).filter((pick) => pick.gameDate >= since);
  const recent = [...picks].sort((first, second) => second.gameDate.localeCompare(first.gameDate)).slice(0, 60);
  const byTag = (tag: string) => picks.filter((pick) => pick.tags?.includes(tag));
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>College record</h1>
          <p>Every flagged NCAAB edge from the last odds pull before tip-off, graded each morning at the price saved. Flat 1-unit stakes.</p>
        </div>
        <Segmented
          label="Window"
          options={[
            { value: "season", label: "Season" },
            { value: "last30", label: "30 days" },
            { value: "last7", label: "7 days" },
          ]}
          value={recordWindow}
          onChange={setRecordWindow}
        />
      </div>
      {record.loading ? <div className="skeleton" style={{ minHeight: 200 }} /> : null}
      {!record.loading && picks.length === 0 ? <div className="card empty-state">No graded college picks yet. They start once the odds workflow has run on a game day.</div> : null}
      {picks.length > 0 ? (
        <>
          <div className="card flush table-scroll" style={{ marginBottom: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>W-L</th>
                  <th>Win %</th>
                  <th>Units</th>
                  <th>ROI</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                <SummaryRow label="All" summary={summarizeRecord(picks)} />
                {modelMarkets.map((market) => (
                  <SummaryRow key={market} label={modelMarketLabels[market]} summary={summarizeRecord(picks.filter((pick) => pick.kind === market))} />
                ))}
                {confidenceTiers.map((tier) => (byTag(confidenceTag(tier)).length > 0 ? <SummaryRow key={tier} label={`${confidenceLevels[tier].label} confidence`} summary={summarizeRecord(byTag(confidenceTag(tier)))} /> : null))}
              </tbody>
            </table>
          </div>
          <h2 className="section-title">Recent picks</h2>
          <div className="card flush">
            {recent.map((pick: TrackedPick) => (
              <div key={pick.trackId} className="result-row">
                <span style={{ minWidth: 0 }}>
                  <span className="strong">{pick.label}</span>
                  <span className="faint small">
                    {" "}
                    · {new Date(`${pick.gameDate}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })} · {formatAmerican(pick.americanOdds)} · {formatSigned(pick.evPercent, 1)}% EV
                  </span>
                </span>
                <span className={`pill ${pick.result ? statusPill[pick.result.status] : ""}`}>{pick.result ? pick.result.status : "pending"}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
