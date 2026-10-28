"use client";

import { useState } from "react";
import { GameRow, SlateHeader } from "@/components/slate/GameRow";
import { Segmented } from "@/components/Segmented";
import { implausibleEvPercent, type LineEdge } from "@/lib/analytics/gameModel";
import { SyncStatus } from "@/components/SyncStatus";
import { BooksIndicator } from "@/components/BooksIndicator";
import { useAnalyticsQuery } from "@/lib/client/hooks";
import { matchBoxScore, useLiveBoxScores, useSlate } from "@/lib/client/slateData";
import { useLineAnalyses } from "@/lib/client/lineModel";
import { groupOddsByGame } from "@/lib/odds/consensus";
import { teamRest } from "@/lib/analytics/aggregates/teamAggregates";
import { todayEastern } from "@/lib/dates";
import { isGameFinal } from "@/lib/data/flatten";

export default function SlatePage() {
  const slate = useSlate();
  const { analyses } = useLineAnalyses(slate); // also saves the Lines model's daily record whenever the slate is open
  const [edgesOnly, setEdgesOnly] = useState(false);
  const bestEdgeByGame = new Map<number, LineEdge>();
  for (const analysis of analyses) {
    const best = analysis.edges.filter((edge) => edge.flagged && edge.evPercent < implausibleEvPercent).sort((first, second) => second.evPercent - first.evPercent)[0];
    if (best) bestEdgeByGame.set(analysis.game.id, best);
  }
  const games = slate.data?.games ?? null;
  const live = useLiveBoxScores(games);
  const teamIds = (games ?? []).flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const today = todayEastern();
  const rest = useAnalyticsQuery(teamIds.length > 0 ? (handle) => teamRest(handle.engine, teamIds, today) : null, `${today}:${teamIds.join(",")}`);
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const openingByGame = groupOddsByGame(slate.data?.openingOdds ?? []);
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const shownGames = [...(games ?? [])]
    .filter((game) => !edgesOnly || bestEdgeByGame.has(game.id))
    .sort((first, second) => Number(isGameFinal(matchBoxScore(first, live.boxScores) ?? first)) - Number(isGameFinal(matchBoxScore(second, live.boxScores) ?? second))); // finished games sink to the bottom, the rest keep tip-off order

  return (
    <main className="page">
      <div className="mobile-sync">
        <SyncStatus />
      </div>
      <div className="page-title">
        <div>
          <h1>{dateLabel}</h1>
          <p>
            {games?.length ?? 0} games · lines refresh every 10 min · tap a price to add it to the slip
          </p>
        </div>
        <div className="row wrap">
          <BooksIndicator />
          <Segmented
            label="Games shown"
            options={[
              { value: "all", label: "All" },
              { value: "edges", label: "Edges only" },
            ]}
            value={edgesOnly ? "edges" : "all"}
            onChange={(next) => setEdgesOnly(next === "edges")}
          />
          <button className="button ghost" onClick={slate.refresh} disabled={slate.loading}>
            {slate.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {slate.error ? <div className="notice">Could not load the slate: {slate.error}</div> : null}
      {slate.data?.notices.map((notice) => (
        <div key={notice} className="notice info" style={{ marginBottom: 10 }}>
          {notice}
        </div>
      ))}
      {!slate.data && slate.loading ? (
        <div className="skeleton" style={{ minHeight: 320 }} />
      ) : null}
      {games && games.length === 0 ? <div className="card empty-state">No games today. Enjoy the night off.</div> : null}
      {shownGames.length > 0 ? (
        <div className="card flush slate-list">
          <SlateHeader />
          {shownGames.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              odds={oddsByGame.get(game.id) ?? []}
              openingOdds={openingByGame.get(game.id) ?? []}
              injuries={slate.data?.injuries ?? []}
              rest={rest.result}
              boxScore={matchBoxScore(game, live.boxScores)}
              modelEdge={bestEdgeByGame.get(game.id) ?? null}
            />
          ))}
        </div>
      ) : null}
      {edgesOnly && games && games.length > 0 && shownGames.length === 0 ? <div className="card empty-state">No model edges on tonight&apos;s pregame lines.</div> : null}
    </main>
  );
}
