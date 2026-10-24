"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { TeamLogo } from "@/components/TeamLogo";
import { defenseScopes, type DefenseMetric, type DefenseTable, type PositionGroup } from "@/lib/analytics/aggregates/defenseVsPosition";
import type { WindowName } from "@/lib/analytics/aggregates/windows";
import { teamById } from "@/lib/nba/teams";
import { formatNumber, rankClass } from "@/lib/client/format";
import { scopeLabels } from "@/lib/analytics/views";

const shownMetrics: Array<{ metric: DefenseMetric; label: string }> = [
  { metric: "pts", label: "PTS" },
  { metric: "reb", label: "REB" },
  { metric: "ast", label: "AST" },
  { metric: "fg3m", label: "3PM" },
  { metric: "pra", label: "PRA" },
  { metric: "stl", label: "STL" },
  { metric: "blk", label: "BLK" },
];

export function MatchupCard({ table, opponentId, positionGroup }: { table: DefenseTable | null; opponentId: number; positionGroup: PositionGroup }) {
  const [windowName, setWindowName] = useState<WindowName>("L10");
  const opponent = teamById(opponentId);
  const teamEntry = table?.[opponentId];
  const groupNames: Record<PositionGroup, string> = { G: "guards", F: "forwards", C: "centers" };
  return (
    <section className="card">
      <div className="card-header wrap">
        <div className="row">
          <TeamLogo teamId={opponentId} />
          <div>
            <h2>
              {opponent?.abbreviation ?? "Opponent"} defense vs {groupNames[positionGroup]}
            </h2>
            <div className="faint small">Per game allowed to opposing {positionGroup}s · rank 1 = allows the most (softest)</div>
          </div>
        </div>
        <Segmented
          options={(["L5", "L10", "L20", "SEASON"] as WindowName[]).map((windowOption) => ({ value: windowOption, label: windowOption === "SEASON" ? "Season" : windowOption }))}
          value={windowName}
          onChange={setWindowName}
          label="Window"
        />
      </div>
      {!teamEntry ? (
        <div className="empty-state">No defensive games logged for {opponent?.abbreviation ?? "this team"} this season.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Segment</th>
                {shownMetrics.map((shown) => (
                  <th key={shown.metric}>{shown.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {defenseScopes.map((scopeName) => {
                const cells = teamEntry[scopeName]?.[positionGroup]?.[windowName];
                return (
                  <tr key={scopeName}>
                    <td className="strong">{scopeLabels[scopeName]}</td>
                    {shownMetrics.map((shown) => {
                      const cell = cells?.[shown.metric];
                      return (
                        <td key={shown.metric}>
                          {formatNumber(cell?.average ?? null)} <span className={`rank-badge ${rankClass(cell?.rank ?? null)}`}>{cell?.rank ?? "-"}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
