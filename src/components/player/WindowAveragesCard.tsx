"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import type { PlayerWindowTable } from "@/lib/analytics/aggregates/playerAggregates";
import { scopeLabels, scopeNames, playerMetricLabels, type PlayerMetric, type ScopeName } from "@/lib/analytics/views";
import { windowNames } from "@/lib/analytics/aggregates/windows";
import { formatNumber } from "@/lib/client/format";

const displayedMetrics: PlayerMetric[] = ["pts", "reb", "ast", "fg3m", "pra", "pr", "pa", "ra", "stl", "blk", "stocks", "turnover", "minutes", "fga", "fta"];

export function WindowAveragesCard({ table, seasons }: { table: PlayerWindowTable | null; seasons: number[] }) {
  const availableSeasons = seasons.filter((season) => table?.[season]);
  const [season, setSeason] = useState<number>(availableSeasons[0] ?? seasons[0]);
  const [scope, setScope] = useState<ScopeName>("FG");
  const activeSeason = availableSeasons.includes(season) ? season : (availableSeasons[0] ?? season);
  const windows = table?.[activeSeason]?.[scope];
  return (
    <section className="card">
      <div className="card-header wrap">
        <h2>Averages ± SD</h2>
        <Segmented options={seasons.map((seasonOption) => ({ value: seasonOption, label: `${seasonOption}-${String((seasonOption + 1) % 100).padStart(2, "0")}` }))} value={activeSeason} onChange={setSeason} label="Season" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <Segmented options={scopeNames.map((scopeName) => ({ value: scopeName, label: scopeLabels[scopeName] }))} value={scope} onChange={setScope} label="Game segment" />
      </div>
      {!windows ? (
        <div className="empty-state">No games for this season yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Stat</th>
                {windowNames.map((windowName) => (
                  <th key={windowName}>
                    {windowName === "SEASON" ? "Season" : windowName}
                    <span className="sub">{windows[windowName].pts.games}g</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedMetrics.map((metricName) => (
                <tr key={metricName}>
                  <td className="strong">{playerMetricLabels[metricName]}</td>
                  {windowNames.map((windowName) => {
                    const summary = windows[windowName][metricName];
                    return (
                      <td key={windowName}>
                        {formatNumber(summary.average)}
                        <span className="sub">±{formatNumber(summary.standardDeviation)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
