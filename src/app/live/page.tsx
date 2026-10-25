"use client";

import { useEffect, useState } from "react";
import { LivePropsPanel } from "@/components/live/LivePropsPanel";
import { BooksIndicator } from "@/components/BooksIndicator";
import { TeamLogo } from "@/components/TeamLogo";
import { BoxScoreTable } from "@/components/live/BoxScoreTable";
import { HalftimePanel } from "@/components/live/HalftimePanel";
import { clockLabel } from "@/lib/analytics/liveProjection";
import { matchBoxScore, useLiveBoxScores, useSlate } from "@/lib/client/slateData";
import { isGameFinal, isGameLive, isHalftime } from "@/lib/data/flatten";
import { formatTipoff } from "@/lib/dates";
import { groupOddsByGame } from "@/lib/odds/consensus";
import type { BdlBettingOdd, BdlBoxScore, BdlGame } from "@/lib/bdl/types";

type SectionName = "props" | "box" | "halftime";

function GameRow({ game, boxScore, gameOdds, initialSection }: { game: BdlGame; boxScore: BdlBoxScore | null; gameOdds: BdlBettingOdd[]; initialSection: SectionName | null }) {
  const [openSection, setOpenSection] = useState<SectionName | null>(initialSection);
  useEffect(() => {
    if (initialSection) setOpenSection(initialSection);
  }, [initialSection]);
  const source = boxScore ?? game;
  const live = isGameLive(source);
  const final = isGameFinal(source);
  const atHalftime = Boolean(boxScore && isHalftime(boxScore));
  const toggle = (section: SectionName) => setOpenSection((current) => (current === section ? null : section));
  const scores = [
    { team: game.visitor_team, score: boxScore?.visitor_team_score ?? game.visitor_team_score },
    { team: game.home_team, score: boxScore?.home_team_score ?? game.home_team_score },
  ];
  return (
    <article id={`game-${game.id}`} className="card game-row" style={{ scrollMarginTop: 64 }}>
      <div className="game-row-header">
        <div className="row-between small" style={{ marginBottom: 6 }}>
          {live ? (
            <span className="pill live">
              <span className="live-dot" />
              {clockLabel(source.status, source.time)}
            </span>
          ) : final ? (
            <span className="pill">Final</span>
          ) : (
            <span className="pill accent">{formatTipoff(game.datetime)}</span>
          )}
          {atHalftime ? <span className="pill warning">Halftime</span> : null}
        </div>
        {scores.map(({ team, score }) => (
          <div key={team.id} className="row-between" style={{ marginTop: 4 }}>
            <span className="row">
              <TeamLogo teamId={team.id} />
              <span className="strong">{team.full_name}</span>
            </span>
            <span className="team-score" style={{ fontSize: 20 }}>
              {live || final ? score : ""}
            </span>
          </div>
        ))}
      </div>
      {boxScore && (live || final) ? (
        <div className="game-row-actions">
          {live ? (
            <button className={`toggle-button${openSection === "props" ? " open" : ""}`} onClick={() => toggle("props")}>
              Player props {openSection === "props" ? "▴" : "▾"}
            </button>
          ) : null}
          {atHalftime ? (
            <button className={`toggle-button${openSection === "halftime" ? " open" : ""}`} onClick={() => toggle("halftime")}>
              Halftime picks {openSection === "halftime" ? "▴" : "▾"}
            </button>
          ) : null}
          <button className={`toggle-button${openSection === "box" ? " open" : ""}`} onClick={() => toggle("box")}>
            Box score {openSection === "box" ? "▴" : "▾"}
          </button>
        </div>
      ) : null}
      {boxScore && openSection === "props" && live ? (
        <div className="game-row-section">
          <LivePropsPanel game={game} boxScore={boxScore} gameOdds={gameOdds} />
        </div>
      ) : null}
      {boxScore && openSection === "halftime" && atHalftime ? (
        <div className="game-row-section">
          <HalftimePanel game={game} boxScore={boxScore} gameOdds={gameOdds} />
        </div>
      ) : null}
      {boxScore && openSection === "box" ? (
        <div className="game-row-section">
          <div className="stack" style={{ gap: 14 }}>
            <BoxScoreTable side={boxScore.visitor_team} />
            <BoxScoreTable side={boxScore.home_team} />
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function LivePage() {
  const slate = useSlate();
  const games = slate.data?.games ?? null;
  const live = useLiveBoxScores(games);
  const [requestedGameId, setRequestedGameId] = useState<number | null>(null);
  useEffect(() => {
    const requestedGame = Number(new URLSearchParams(window.location.search).get("game")); // deep link from the slate: /live?game=123
    if (Number.isInteger(requestedGame) && requestedGame > 0) setRequestedGameId(requestedGame);
  }, []);
  const [scrolledTo, setScrolledTo] = useState<number | null>(null);
  useEffect(() => {
    if (requestedGameId === null || scrolledTo === requestedGameId) return;
    const target = document.getElementById(`game-${requestedGameId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" }); // jump to the game tapped on the slate
      setScrolledTo(requestedGameId);
    }
  });
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const enriched = (games ?? []).map((game) => ({ game, boxScore: matchBoxScore(game, live.boxScores) }));
  const stateOrder = (entry: (typeof enriched)[number]) => (isGameLive(entry.boxScore ?? entry.game) ? 0 : isGameFinal(entry.boxScore ?? entry.game) ? 2 : 1); // live first, then upcoming, then finals
  const ordered = [...enriched].sort((first, second) => stateOrder(first) - stateOrder(second));
  const liveCount = enriched.filter(({ game, boxScore }) => isGameLive(boxScore ?? game)).length;
  const nextPollText = live.nextPollAt ? (live.nextPollAt - Date.now() > 120_000 ? `sleeping until ${new Date(live.nextPollAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "updating every 30s") : "no games left today";

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Live</h1>
          <p>
            {liveCount} live · {nextPollText}
            {live.lastUpdated ? ` · updated ${new Date(live.lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}
          </p>
        </div>
        <BooksIndicator />
      </div>
      {live.error ? <div className="notice">Live feed error: {live.error}</div> : null}
      {games && games.length === 0 ? <div className="card empty-state">No games today.</div> : null}
      {ordered.map(({ game, boxScore }) => {
        const deepLinked = game.id === requestedGameId;
        const initialSection: SectionName | null = deepLinked && boxScore ? (isHalftime(boxScore) ? "halftime" : isGameLive(boxScore) ? "props" : "box") : null;
        return <GameRow key={game.id} game={game} boxScore={boxScore} gameOdds={oddsByGame.get(game.id) ?? []} initialSection={initialSection} />;
      })}
      {games && liveCount === 0 && games.length > 0 ? <p className="faint small">No games in progress. The page sleeps until the next tip-off, and polling stops while this tab is hidden.</p> : null}
    </main>
  );
}
