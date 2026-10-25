"use client";

import { GameCard } from "@/components/slate/GameCard";
import { SyncStatus } from "@/components/SyncStatus";
import { BooksIndicator } from "@/components/BooksIndicator";
import { useAnalyticsQuery } from "@/lib/client/hooks";
import { matchBoxScore, useLiveBoxScores, useSlate } from "@/lib/client/slateData";
import { groupOddsByGame } from "@/lib/odds/consensus";
import { teamRest } from "@/lib/analytics/aggregates/teamAggregates";
import { todayEastern } from "@/lib/dates";

export default function SlatePage() {
  const slate = useSlate();
  const games = slate.data?.games ?? null;
  const live = useLiveBoxScores(games);
  const teamIds = (games ?? []).flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const today = todayEastern();
  const rest = useAnalyticsQuery(teamIds.length > 0 ? (handle) => teamRest(handle.engine, teamIds, today) : null, `${today}:${teamIds.join(",")}`);
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const openingByGame = groupOddsByGame(slate.data?.openingOdds ?? []);
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <main className="page">
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <span className="mobile-sync" style={{ marginBottom: 0 }}>
          <SyncStatus />
        </span>
        <BooksIndicator />
      </div>
      <div className="page-title">
        <div>
          <h1>Today&apos;s slate</h1>
          <p>
            {dateLabel} · {games?.length ?? 0} games · lines refresh every 10 min while open
          </p>
        </div>
        <button className="button ghost" onClick={slate.refresh} disabled={slate.loading}>
          {slate.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {slate.error ? <div className="notice">Could not load the slate: {slate.error}</div> : null}
      {slate.data?.notices.map((notice) => (
        <div key={notice} className="notice info" style={{ marginBottom: 10 }}>
          {notice}
        </div>
      ))}
      {!slate.data && slate.loading ? (
        <div className="grid-two">
          {[0, 1, 2, 3].map((placeholderIndex) => (
            <div key={placeholderIndex} className="skeleton" style={{ minHeight: 220 }} />
          ))}
        </div>
      ) : null}
      {games && games.length === 0 ? <div className="card empty-state">No games today. Enjoy the night off.</div> : null}
      <div className="grid-two">
        {(games ?? []).map((game) => (
          <GameCard
            key={game.id}
            game={game}
            odds={oddsByGame.get(game.id) ?? []}
            openingOdds={openingByGame.get(game.id) ?? []}
            injuries={slate.data?.injuries ?? []}
            rest={rest.result}
            boxScore={matchBoxScore(game, live.boxScores)}
          />
        ))}
      </div>
    </main>
  );
}
