"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import type { PlayerGameLogRow } from "@/lib/analytics/aggregates/playerAggregates";
import { playerMetricLabels, type PlayerMetric, type ScopeName } from "@/lib/analytics/views";
import { teamById } from "@/lib/nba/teams";
import { formatNumber } from "@/lib/client/format";

const gameColumns: PlayerMetric[] = ["minutes", "pts", "reb", "ast", "fg3m", "stl", "blk", "turnover", "pra", "fga", "fta", "pf", "plus_minus"];
const quarterScopes: ScopeName[] = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "T3", "FG"];
const quarterMetricOptions: PlayerMetric[] = ["pts", "reb", "ast", "fg3m", "pra", "minutes"];

export function GameLogCard({ logsBySeason, seasons, loading }: { logsBySeason: Record<number, PlayerGameLogRow[]>; seasons: number[]; loading: boolean }) {
  const [season, setSeason] = useState(seasons[0]);
  const [view, setView] = useState<"game" | "quarter">("game");
  const [quarterMetric, setQuarterMetric] = useState<PlayerMetric>("pts");
  const rows = logsBySeason[season] ?? [];
  const games = new Map<number, Partial<Record<ScopeName, PlayerGameLogRow>>>();
  for (const logRow of rows) {
    const entry = games.get(logRow.game_id) ?? {};
    entry[logRow.scope] = logRow;
    games.set(logRow.game_id, entry);
  }
  const orderedGames = [...games.values()].filter((entry) => entry.FG).sort((first, second) => String(second.FG!.game_date).localeCompare(String(first.FG!.game_date)));
  return (
    <section className="card">
      <div className="card-header wrap">
        <h2>Game log</h2>
        <div className="row wrap">
          <Segmented options={seasons.map((seasonOption) => ({ value: seasonOption, label: String(seasonOption) }))} value={season} onChange={setSeason} label="Season" />
          <Segmented
            options={[
              { value: "game", label: "Per game" },
              { value: "quarter", label: "Per quarter" },
            ]}
            value={view}
            onChange={setView}
            label="View"
          />
        </div>
      </div>
      {view === "quarter" ? (
        <div style={{ marginBottom: 10 }}>
          <Segmented options={quarterMetricOptions.map((metricName) => ({ value: metricName, label: playerMetricLabels[metricName] }))} value={quarterMetric} onChange={setQuarterMetric} label="Stat" />
        </div>
      ) : null}
      {loading ? <div className="skeleton" /> : null}
      {!loading && orderedGames.length === 0 ? <div className="empty-state">No games logged for {season}.</div> : null}
      {orderedGames.length > 0 ? (
        <div className="table-scroll" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Game</th>
                {view === "game" ? gameColumns.map((metricName) => <th key={metricName}>{playerMetricLabels[metricName]}</th>) : quarterScopes.map((scopeName) => <th key={scopeName}>{scopeName === "FG" ? "Full" : scopeName === "T3" ? "Thru 3" : scopeName}</th>)}
              </tr>
            </thead>
            <tbody>
              {orderedGames.map((entry) => {
                const fullGame = entry.FG!;
                const opponent = teamById(Number(fullGame.opponent_team_id));
                return (
                  <tr key={fullGame.game_id}>
                    <td>
                      <span className="tabular">{String(fullGame.game_date).slice(5)}</span> {fullGame.is_home ? "vs" : "@"} {opponent?.abbreviation ?? "?"}
                    </td>
                    {view === "game"
                      ? gameColumns.map((metricName) => <td key={metricName}>{formatNumber(Number(fullGame[metricName]), metricName === "minutes" ? 1 : 0)}</td>)
                      : quarterScopes.map((scopeName) => <td key={scopeName}>{entry[scopeName] ? formatNumber(Number(entry[scopeName]![quarterMetric]), quarterMetric === "minutes" ? 1 : 0) : "-"}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
