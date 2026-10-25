"use client";

import { useEffect, useState } from "react";
import { LivePropsPanel } from "@/components/live/LivePropsPanel";
import { BooksIndicator } from "@/components/BooksIndicator";
import { clockLabel } from "@/lib/analytics/liveProjection";
import { TeamLogo } from "@/components/TeamLogo";
import { BoxScoreTable } from "@/components/live/BoxScoreTable";
import { HalftimePanel } from "@/components/live/HalftimePanel";
import { matchBoxScore, useLiveBoxScores, useSlate } from "@/lib/client/slateData";
import { isGameFinal, isGameLive, isHalftime } from "@/lib/data/flatten";
import { formatTipoff } from "@/lib/dates";
import { groupOddsByGame } from "@/lib/odds/consensus";

function clockText(status: string | null | undefined, time: string | null | undefined): string {
  return clockLabel(status, time);
}

export default function LivePage() {
  const slate = useSlate();
  const games = slate.data?.games ?? null;
  const live = useLiveBoxScores(games);
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  useEffect(() => {
    const requestedGame = Number(new URLSearchParams(window.location.search).get("game")); // deep link from the slate: /live?game=123
    if (Number.isInteger(requestedGame) && requestedGame > 0) {
      setSelectedGameId(requestedGame);
      setScrollPending(true);
    }
  }, []);
  const [scrollPending, setScrollPending] = useState(false);
  useEffect(() => {
    if (!scrollPending) return;
    const target = document.getElementById("halftime-panel") ?? document.getElementById("live-props");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" }); // jump to the game you tapped on the slate
      setScrollPending(false);
    }
  });
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const enriched = (games ?? []).map((game) => ({ game, boxScore: matchBoxScore(game, live.boxScores) }));
  const liveGames = enriched.filter(({ game, boxScore }) => isGameLive(boxScore ?? game));
  const halftimeGames = enriched.filter(({ boxScore }) => boxScore && isHalftime(boxScore));
  const selected = enriched.find(({ game }) => game.id === selectedGameId) ?? liveGames[0] ?? null;
  const nextPollText = live.nextPollAt ? (live.nextPollAt - Date.now() > 120_000 ? `sleeping until ${new Date(live.nextPollAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "updating every 30s") : "no games left today";

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Live</h1>
          <p>
            {liveGames.length} live · {nextPollText}
            {live.lastUpdated ? ` · updated ${new Date(live.lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}
          </p>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <BooksIndicator />
      </div>
      {live.error ? <div className="notice">Live feed error: {live.error}</div> : null}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", marginBottom: 12 }}>
        {enriched.map(({ game, boxScore }) => {
          const source = boxScore ?? game;
          const isLive = isGameLive(source);
          const isSelected = selected?.game.id === game.id;
          return (
            <button key={game.id} className="card" onClick={() => setSelectedGameId(game.id)} style={{ marginTop: 0, textAlign: "left", cursor: "pointer", borderColor: isSelected ? "var(--accent)" : undefined }}>
              <div className="row-between small" style={{ marginBottom: 8 }}>
                {isLive ? (
                  <span className="pill live">
                    <span className="live-dot" />
                    {clockText(source.status, source.time)}
                  </span>
                ) : isGameFinal(source) ? (
                  <span className="pill">Final</span>
                ) : (
                  <span className="pill accent">{formatTipoff(game.datetime)}</span>
                )}
                {boxScore && isHalftime(boxScore) ? <span className="pill warning">Halftime mode</span> : isLive ? <span className="pill accent">Props</span> : null}
              </div>
              {[
                { team: game.visitor_team, score: boxScore?.visitor_team_score ?? game.visitor_team_score },
                { team: game.home_team, score: boxScore?.home_team_score ?? game.home_team_score },
              ].map(({ team, score }) => (
                <div key={team.id} className="row-between" style={{ marginTop: 4 }}>
                  <span className="row">
                    <TeamLogo teamId={team.id} />
                    <span className="strong">{team.abbreviation}</span>
                  </span>
                  <span className="team-score" style={{ fontSize: 20 }}>
                    {isLive || isGameFinal(source) ? score : ""}
                  </span>
                </div>
              ))}
            </button>
          );
        })}
      </div>
      {halftimeGames.length > 0 && !halftimeGames.some(({ game }) => game.id === selected?.game.id) ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          At halftime: {halftimeGames.map(({ game }) => `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`).join(", ")}. Tap the game above for halftime suggestions.
        </div>
      ) : null}
      {selected?.boxScore && isHalftime(selected.boxScore) ? (
        <div style={{ marginBottom: 12 }}>
          <span id="halftime-panel" />
          <HalftimePanel game={selected.game} boxScore={selected.boxScore} gameOdds={oddsByGame.get(selected.game.id) ?? []} />
        </div>
      ) : null}
      {selected?.boxScore && isGameLive(selected.boxScore) ? (
        <div style={{ marginBottom: 12 }}>
          <LivePropsPanel game={selected.game} boxScore={selected.boxScore} gameOdds={oddsByGame.get(selected.game.id) ?? []} />
        </div>
      ) : null}
      {selected?.boxScore ? (
        <section className="card">
          <div className="card-header">
            <h2>
              Box score · {selected.game.visitor_team.abbreviation} {selected.boxScore.visitor_team_score} - {selected.boxScore.home_team_score} {selected.game.home_team.abbreviation}
            </h2>
            <span className="faint small">{clockText(selected.boxScore.status, selected.boxScore.time)} · cumulative</span>
          </div>
          <div className="grid-two">
            <BoxScoreTable side={selected.boxScore.visitor_team} />
            <BoxScoreTable side={selected.boxScore.home_team} />
          </div>
        </section>
      ) : games && liveGames.length === 0 ? (
        <div className="card empty-state">No games in progress. The page sleeps until the next tip-off and polling stops while this tab is hidden.</div>
      ) : null}
    </main>
  );
}
