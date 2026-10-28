"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import type { PlayerWindowTable } from "@/lib/analytics/aggregates/playerAggregates";
import type { PlayerMetric } from "@/lib/analytics/views";
import type { WindowName } from "@/lib/analytics/aggregates/windows";
import { formatNumber } from "@/lib/client/format";

const stripMetrics: Array<{ metric: PlayerMetric; label: string }> = [
  { metric: "pts", label: "Pts" },
  { metric: "reb", label: "Reb" },
  { metric: "ast", label: "Ast" },
  { metric: "fg3m", label: "3PM" },
  { metric: "minutes", label: "Min" },
  { metric: "pra", label: "PRA" },
];

export function StatStrip({ table, seasons }: { table: PlayerWindowTable | null; seasons: number[] }) {
  const [windowName, setWindowName] = useState<WindowName>("L10");
  const season = seasons.find((candidate) => table?.[candidate]?.FG);
  const windows = season === undefined ? null : table?.[season]?.FG;
  if (!windows) return null;
  return (
    <div className="stack" style={{ gap: 10, marginBottom: 12 }}>
      <Segmented
        label="Averages window"
        options={[
          { value: "L5", label: "Last 5" },
          { value: "L10", label: "Last 10" },
          { value: "SEASON", label: "Season" },
        ]}
        value={windowName}
        onChange={setWindowName}
      />
      <div className="stat-strip">
        {stripMetrics.map(({ metric, label }) => (
          <div key={metric}>
            <strong>{formatNumber(windows[windowName][metric].average)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
