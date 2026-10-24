"use client";

import Link from "next/link";
import type { UsageShiftResult } from "@/lib/analytics/aggregates/usageShift";
import type { BdlPlayerInjury } from "@/lib/bdl/types";
import { formatNumber, formatSigned } from "@/lib/client/format";

const shiftColumns = [
  { metric: "minutes", label: "MIN" },
  { metric: "pts", label: "PTS" },
  { metric: "reb", label: "REB" },
  { metric: "ast", label: "AST" },
  { metric: "fg3m", label: "3PM" },
  { metric: "pra", label: "PRA" },
  { metric: "fga", label: "FGA" },
  { metric: "usage_percentage", label: "USG" },
] as const;

export function UsageShiftCard({ shifts, injuries }: { shifts: UsageShiftResult[]; injuries: BdlPlayerInjury[] }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>Usage shift when a listed teammate is out</h2>
      </div>
      {shifts.length === 0 ? (
        <div className="empty-state">No teammates on today&apos;s injury report.</div>
      ) : (
        <div className="stack">
          {shifts.map((shift) => {
            const injury = injuries.find((candidate) => candidate.player.id === shift.teammateId);
            return (
              <div key={shift.teammateId} className="prop-card">
                <div className="row-between">
                  <Link href={`/player/${shift.teammateId}`} className="strong">
                    {injury ? `${injury.player.first_name} ${injury.player.last_name}` : `Player ${shift.teammateId}`}
                  </Link>
                  <span className={`pill ${/out/i.test(injury?.status ?? "") ? "negative" : "warning"}`}>{injury?.status ?? "listed"}</span>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Split</th>
                        {shiftColumns.map((column) => (
                          <th key={column.metric}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>With ({shift.withTeammate.games}g)</td>
                        {shiftColumns.map((column) => (
                          <td key={column.metric}>{column.metric === "usage_percentage" ? formatNumber((shift.withTeammate.averages[column.metric] ?? NaN) * 100) : formatNumber(shift.withTeammate.averages[column.metric])}</td>
                        ))}
                      </tr>
                      <tr>
                        <td>Without ({shift.withoutTeammate.games}g)</td>
                        {shiftColumns.map((column) => (
                          <td key={column.metric}>{column.metric === "usage_percentage" ? formatNumber((shift.withoutTeammate.averages[column.metric] ?? NaN) * 100) : formatNumber(shift.withoutTeammate.averages[column.metric])}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="strong">Shift</td>
                        {shiftColumns.map((column) => {
                          const delta = shift.deltas[column.metric];
                          const scaled = delta === null ? null : column.metric === "usage_percentage" ? delta * 100 : delta;
                          return (
                            <td key={column.metric} className={scaled === null ? "" : scaled > 0 ? "positive" : scaled < 0 ? "negative" : ""}>
                              {formatSigned(scaled)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                {shift.withoutTeammate.games === 0 ? <div className="faint small">No games without this teammate yet, so there is no shift to measure.</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
