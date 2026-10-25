"use client";

import { useEffect, useState } from "react";
import { LivePropsPanel, shootingTag } from "@/components/live/LivePropsPanel";
import { BooksIndicator } from "@/components/BooksIndicator";
import { TeamLogo } from "@/components/TeamLogo";
import { BoxScoreTable } from "@/components/live/BoxScoreTable";
import { clockLabel } from "@/lib/analytics/liveProjection";
import { matchBoxScore, useLiveBoxScores, useLiveOdds, useSlate } from "@/lib/client/slateData";
import { filterByBooks } from "@/lib/client/bookFilter";
import { useSettings } from "@/lib/client/hooks";
import { isGameFinal, isGameLive, isHalftime, isPotentialBlowout } from "@/lib/data/flatten";
import { appSettings } from "@/config/appSettings";
import { formatTipoff, todayEastern } from "@/lib/dates";
import { groupOddsByGame } from "@/lib/odds/consensus";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlGameScoreDetail } from "@/lib/bdl/types";
import { useLivePropData, type LivePropData } from "@/lib/client/liveProps";
import { PriceButton } from "@/components/PriceButton";
import { buildPropPick } from "@/lib/client/pickBuilders";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";

type SectionName = "props" | "box";

const pointsProp = new Set(["points", "threes", "points_rebounds_assists", "points_rebounds", "points_assists"]); // props where shooting luck matters

const periodKeys = ["q1", "q2", "q3", "q4", "ot1", "ot2", "ot3"] as const;
const periodHeaders = ["1", "2", "3", "4", "OT", "2OT", "3OT"];

function periodScore(side: "home" | "visitor", periodKey: (typeof periodKeys)[number], fresh: BdlGameScoreDetail | null, fallback: BdlGameScoreDetail): number | null {
  const fieldName = `${side}_${periodKey}` as keyof BdlGameScoreDetail;
  const freshValue = fresh?.[fieldName];
  const value = typeof freshValue === "number" ? freshValue : fallback[fieldName]; // box score polls every 30s, the slate every 10 min
  return typeof value === "number" ? value : null;
}

function QuarterScores({ game, boxScore }: { game: BdlGame; boxScore: BdlBoxScore | null }) {
  const source = boxScore ?? game;
  const currentPeriod = isGameFinal(source) ? Math.max(4, source.period ?? 4) : Math.max(1, source.period ?? 1); // the API sends 0 for quarters not played yet
  const sides = [
    { side: "visitor" as const, team: game.visitor_team },
    { side: "home" as const, team: game.home_team },
  ];
  const shownPeriods = periodKeys.map((periodKey, periodIndex) => ({ periodKey, periodIndex })).filter(({ periodIndex }) => periodIndex < Math.max(4, currentPeriod)); // overtime columns only when played
  if (!sides.some(({ side }) => periodScore(side, "q1", boxScore, game) !== null)) return null;
  return (
    <table className="quarter-scores tabular small">
      <thead>
        <tr>
          <th />
          {shownPeriods.map(({ periodIndex }) => (
            <th key={periodIndex}>{periodHeaders[periodIndex]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sides.map(({ side, team }) => {
          const inBonus = boxScore?.[`${side}_in_bonus`] === true; // bonus and timeouts only from the fresh box score
          const timeoutsLeft = boxScore?.[`${side}_timeouts_remaining`];
          return (
            <tr key={side}>
              <td className="muted">
                {team.abbreviation}
                {typeof timeoutsLeft === "number" ? <span className="faint"> · {timeoutsLeft} TO</span> : null}
                {inBonus ? <span className="pill"> bonus</span> : null}
              </td>
              {shownPeriods.map(({ periodKey, periodIndex }) => (
                <td key={periodIndex}>{periodIndex < currentPeriod ? (periodScore(side, periodKey, boxScore, game) ?? "–") : "–"}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TopPicks({ game, data, gameOdds, atHalftime, blowout }: { game: BdlGame; data: LivePropData; gameOdds: BdlBettingOdd[]; atHalftime: boolean; blowout: boolean }) {
  if (data.loading) return null;
  const topPicks = data.valuePicks.slice(0, 5);
  return (
    <div className="top-picks">
      <div className="section-label">{atHalftime ? "Halftime picks" : "Top live picks"}</div>
      {blowout ? <div className="warning-text small">Blowout risk: starters may sit, so overs and spreads are riskier.</div> : null}
      {data.market ? (
        <div className="faint small">
          Live total {data.market.liveTotal}
          {data.market.paceFactor !== null ? (Math.abs(data.market.paceFactor - 1) < 0.02 ? " · scoring pace as expected" : ` · books expect ${data.market.paceFactor > 1 ? "+" : ""}${Math.round((data.market.paceFactor - 1) * 100)}% scoring vs. pregame`) : ""}
          {data.market.liveSpreadHome !== null ? ` · ${game.home_team.abbreviation} ${data.market.liveSpreadHome > 0 ? "+" : ""}${data.market.liveSpreadHome}` : ""}
        </div>
      ) : null}
      {data.rows
        .filter((propRow, rowIndex, allRows) => propRow.inactiveNote && allRows.findIndex((otherRow) => otherRow.playerId === propRow.playerId) === rowIndex)
        .slice(0, 3)
        .map((propRow) => (
          <div key={`out-${propRow.playerId}`} className="warning-text small">
            ⚠ {propRow.playerName}: {propRow.inactiveNote}
          </div>
        ))}
      {topPicks.length === 0 ? (
        <div className="faint small">{data.rows.length === 0 ? "No props posted right now." : "No value right now. Checks again every minute."}</div>
      ) : (
        topPicks.map((propRow) => {
          const side = propRow.evaluation.bestSide ?? "over";
          const odds = side === "over" ? propRow.bestOverOdds : propRow.bestUnderOdds;
          const vendor = side === "over" ? propRow.bestOverVendor : propRow.bestUnderVendor;
          const chance = side === "over" ? propRow.evaluation.overProbability : propRow.evaluation.underProbability;
          const pick = buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, side, data.props, gameOdds, atHalftime ? "halftime" : "live", chance, propRow.lineValue);
          return (
            <div key={`${propRow.playerId}-${propRow.propType}`} className="top-pick">
              <div className="top-pick-text">
                <div className="top-pick-title">
                  <span className="strong">{propRow.playerName}</span>{" "}
                  <span className={side === "over" ? "positive" : "negative"}>
                    {side === "over" ? "O" : "U"} {propRow.lineValue}
                  </span>{" "}
                  <span className="muted">{propRow.label}</span>
                </div>
                <div className="top-pick-stats faint">
                  now {propRow.currentValue}
                  {propRow.restOfGame ? ` · ${propRow.restOfGame.label} avg ${formatNumber(propRow.restOfGame.value)}` : ""} · hit {formatPercent(chance, 0)}
                  {pointsProp.has(propRow.propType) && shootingTag(propRow.shooting) ? ` · ${shootingTag(propRow.shooting)}` : ""}
                </div>
              </div>
              <PriceButton pick={pick} sideLabel="" odds={odds} vendor={vendor} note={`${formatSigned(propRow.evaluation.bestEvPercent, 0)}% EV`} highlight compact />
            </div>
          );
        })
      )}
    </div>
  );
}

function GameRow({ game, boxScore, gameOdds, liveOdds, openingOdds, initialSection }: { game: BdlGame; boxScore: BdlBoxScore | null; gameOdds: BdlBettingOdd[]; liveOdds: BdlBettingOdd[]; openingOdds: BdlBettingOdd[]; initialSection: SectionName | null }) {
  const [openSection, setOpenSection] = useState<SectionName | null>(initialSection);
  useEffect(() => {
    if (initialSection) setOpenSection(initialSection);
  }, [initialSection]);
  const source = boxScore ?? game;
  const live = isGameLive(source);
  const final = isGameFinal(source);
  const atHalftime = Boolean(boxScore && isHalftime(boxScore));
  const liveData = useLivePropData(game, boxScore, live && Boolean(boxScore), liveOdds, openingOdds); // loads props for live games so picks show without opening anything
  const liveSpreadSize = liveData.market?.liveSpreadHome !== null && liveData.market?.liveSpreadHome !== undefined ? Math.abs(liveData.market.liveSpreadHome) : null;
  const blowout = isPotentialBlowout(source) || (live && liveSpreadSize !== null && liveSpreadSize >= appSettings.blowoutWarningMargin); // the score now, or where books expect it to end
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
            <span className="row">
              <span className="pill live">
                <span className="live-dot" />
                {clockLabel(source.status, source.time)}
              </span>
              {blowout ? <span className="pill warning">Potential blowout</span> : null}
            </span>
          ) : final ? (
            <span className="pill">Final</span>
          ) : (
            <span className="pill accent">{formatTipoff(game.datetime)}</span>
          )}
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
        {live || final ? <QuarterScores game={game} boxScore={boxScore} /> : null}
      </div>
      {live && boxScore ? <TopPicks game={game} data={liveData} gameOdds={gameOdds} atHalftime={atHalftime} blowout={blowout} /> : null}
      {boxScore && (live || final) ? (
        <div className="game-row-actions">
          {live ? (
            <button className={`toggle-button${openSection === "props" ? " open" : ""}`} onClick={() => toggle("props")}>
              All player props{liveData.rows.length > 0 ? ` (${new Set(liveData.rows.map((propRow) => propRow.playerId)).size})` : ""} {openSection === "props" ? "▴" : "▾"}
            </button>
          ) : null}
          <button className={`toggle-button${openSection === "box" ? " open" : ""}`} onClick={() => toggle("box")}>
            Box score {openSection === "box" ? "▴" : "▾"}
          </button>
        </div>
      ) : null}
      {boxScore && openSection === "props" && live ? (
        <div className="game-row-section">
          <LivePropsPanel game={game} data={liveData} gameOdds={gameOdds} />
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
  const settings = useSettings();
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
  const enriched = (games ?? []).map((game) => ({ game, boxScore: matchBoxScore(game, live.boxScores) }));
  const stateOrder = (entry: (typeof enriched)[number]) => (isGameLive(entry.boxScore ?? entry.game) ? 0 : isGameFinal(entry.boxScore ?? entry.game) ? 2 : 1); // live first, then upcoming, then finals
  const ordered = [...enriched].sort((first, second) => stateOrder(first) - stateOrder(second));
  const liveCount = enriched.filter(({ game, boxScore }) => isGameLive(boxScore ?? game)).length;
  const liveOdds = useLiveOdds(slate.data?.date ?? todayEastern(), liveCount > 0);
  const rawLiveOddsByGame = groupOddsByGame(liveOdds.data ?? []);
  const oddsByGame = groupOddsByGame(liveOdds.data ? filterByBooks(liveOdds.data, settings.enabledBooks) : (slate.data?.odds ?? [])); // live lines every minute, only the chosen books for prices
  const openingByGame = groupOddsByGame(slate.data?.openingOdds ?? []);
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
        const initialSection: SectionName | null = deepLinked && boxScore ? (isGameLive(boxScore) ? "props" : "box") : null;
        return <GameRow key={game.id} game={game} boxScore={boxScore} gameOdds={oddsByGame.get(game.id) ?? []} liveOdds={rawLiveOddsByGame.get(game.id) ?? []} openingOdds={openingByGame.get(game.id) ?? []} initialSection={initialSection} />;
      })}
      {games && liveCount === 0 && games.length > 0 ? <p className="faint small">No games in progress. The page sleeps until the next tip-off, and polling stops while this tab is hidden.</p> : null}
    </main>
  );
}
