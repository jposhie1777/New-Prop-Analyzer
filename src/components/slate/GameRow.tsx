"use client";

import Link from "next/link";
import { useState } from "react";
import type { LineEdge } from "@/lib/analytics/gameModel";
import { formatNumber } from "@/lib/client/format";
import { TeamLogo } from "@/components/TeamLogo";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlayerInjury } from "@/lib/bdl/types";
import { consensusLine, medianAmerican } from "@/lib/odds/consensus";
import { buildGamePick, formatSpread, mostCommonLine, type GameSelection } from "@/lib/client/pickBuilders";
import { addPick, removePick, type SlipPick } from "@/lib/client/betSlip";
import { formatAmerican } from "@/lib/math/odds";
import { formatTipoff } from "@/lib/dates";
import { isGameFinal, isGameLive, isPotentialBlowout } from "@/lib/data/flatten";
import type { RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import { resolveSelectionLink, vendorLabel } from "@/lib/odds/deeplinks";
import { useSettings, useSlip } from "@/lib/client/hooks";
import { clockLabel } from "@/lib/analytics/liveProjection";

function Movement({ current, opening, invertGood = false, label = "", format = (value: number) => String(value) }: { current: number | null; opening: number | null; invertGood?: boolean; label?: string; format?: (value: number) => string }) {
  if (current === null || opening === null) return <span>-</span>;
  const delta = Math.round((current - opening) * 10) / 10;
  if (delta === 0) return <span>{label}{format(opening)}</span>;
  const goodDirection = invertGood ? delta < 0 : delta > 0;
  return (
    <span className={goodDirection ? "positive" : "negative"}>
      {label}
      {format(opening)} {delta > 0 ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

function MarketCell({ pick, lineText }: { pick: Omit<SlipPick, "addedAt"> | null; lineText: ((line: number) => string) | null }) {
  const slip = useSlip();
  if (!pick) return <span className="slate-cell disabled">-</span>;
  const offeredLines = pick.offers.map((offer) => offer.lineValue).filter((lineValue): lineValue is number => lineValue !== null);
  const typicalLine = offeredLines.length > 0 ? mostCommonLine(offeredLines) : null;
  const pricesAtLine = pick.offers.filter((offer) => typicalLine === null || offer.lineValue === typicalLine).map((offer) => offer.americanOdds);
  const typicalOdds = medianAmerican(pricesAtLine); // what most books charge at the most common line
  const inSlip = slip.some((existing) => existing.pickId === pick.pickId);
  return (
    <button
      className={`slate-cell${inSlip ? " selected" : ""}`}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation(); // adding a price never opens or closes the row
        if (inSlip) removePick(pick.pickId);
        else addPick(pick);
      }}
      aria-pressed={inSlip}
      title={inSlip ? "Tap to remove from slip" : "Add to slip"}
    >
      {lineText && typicalLine !== null ? <span className="slate-cell-line">{lineText(typicalLine)}</span> : null}
      <span className="slate-cell-odds">{formatAmerican(typicalOdds)}</span>
    </button>
  );
}

function RestBadge({ rest }: { rest: RestInfo | undefined }) {
  if (!rest || rest.restDays === null) return null;
  if (rest.backToBack) return <span className="pill warning">B2B</span>;
  if (rest.restDays > 30) return <span className="pill">Opener</span>; // first game since the offseason
  return <span className="pill">{rest.restDays}d rest</span>;
}

function statusLine(game: BdlGame, boxScore: BdlBoxScore | null) {
  const liveSource = boxScore ?? game;
  if (isGameLive(liveSource)) {
    return (
      <span className="pill live">
        <span className="live-dot" />
        {clockLabel(liveSource.status, liveSource.time)}
      </span>
    );
  }
  if (isGameFinal(liveSource)) return <span className="pill">Final</span>;
  return <span className="slate-time">{formatTipoff(game.datetime).replace(" ET", "")}</span>;
}

function injurySummary(teams: BdlGame["home_team"][], teamInjuries: (teamId: number) => BdlPlayerInjury[]): string {
  return teams
    .map((team) => ({ team, listed: teamInjuries(team.id) }))
    .filter(({ listed }) => listed.length > 0)
    .map(({ team, listed }) => {
      const outCount = listed.filter((injury) => /out/i.test(injury.status)).length;
      const otherCount = listed.length - outCount; // questionable, doubtful, day-to-day
      return `${team.abbreviation} ${[outCount > 0 ? `${outCount} out` : "", otherCount > 0 ? `${otherCount} GTD` : ""].filter(Boolean).join(", ")}`;
    })
    .join(" · ");
}

export function SlateHeader() {
  return (
    <div className="slate-head" aria-hidden>
      <span>Tip</span>
      <span>Game</span>
      <span>Spread</span>
      <span>Total</span>
      <span>Money</span>
      <span>Model</span>
      <span />
    </div>
  );
}

export function GameRow({ game, odds, openingOdds, injuries, rest, boxScore, modelEdge }: { game: BdlGame; odds: BdlBettingOdd[]; openingOdds: BdlBettingOdd[]; injuries: BdlPlayerInjury[]; rest: Map<number, RestInfo> | null; boxScore: BdlBoxScore | null; modelEdge: LineEdge | null }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const current = consensusLine(odds);
  const opening = consensusLine(openingOdds);
  const live = isGameLive(boxScore ?? game);
  const showScores = live || isGameFinal(boxScore ?? game);
  const homeScore = boxScore?.home_team_score ?? game.home_team_score;
  const visitorScore = boxScore?.visitor_team_score ?? game.visitor_team_score;
  const pick = (selection: GameSelection) => buildGamePick(game, odds, selection, "slate");
  const teamInjuries = (teamId: number) => injuries.filter((injury) => injury.player.team?.id === teamId || injury.player.team_id === teamId);
  const injuryText = injurySummary([game.visitor_team, game.home_team], teamInjuries);
  const marketColumns = [
    { label: "Spread", visitor: pick("spread_away"), home: pick("spread_home"), visitorText: (line: number) => formatSpread(line), homeText: (line: number) => formatSpread(line) },
    { label: "Total", visitor: pick("total_over"), home: pick("total_under"), visitorText: (line: number) => `o${line}`, homeText: (line: number) => `u${line}` },
    { label: "Money", visitor: pick("moneyline_away"), home: pick("moneyline_home"), visitorText: null, homeText: null },
  ];
  return (
    <div className={`slate-game${open ? " open" : ""}`}>
      <div className="slate-row" onClick={() => setOpen((wasOpen) => !wasOpen)}>
        <div className="slate-tip">{statusLine(game, boxScore)}</div>
        <div className="slate-teams">
          {[game.visitor_team, game.home_team].map((team, teamIndex) => (
            <div key={team.id} className="slate-team">
              <TeamLogo teamId={team.id} />
              <span className="slate-team-name">{team.full_name}</span>
              <RestBadge rest={rest?.get(team.id)} />
              {showScores ? <span className="slate-score">{teamIndex === 0 ? visitorScore : homeScore}</span> : null}
            </div>
          ))}
        </div>
        <div className="slate-markets">
          {marketColumns.map((column) => (
            <div key={column.label} className="slate-market">
              <span className="slate-market-label">{column.label}</span>
              <MarketCell pick={column.visitor} lineText={column.visitorText} />
              <MarketCell pick={column.home} lineText={column.homeText} />
            </div>
          ))}
        </div>
        <div className="slate-model">
          {live ? (
            <Link href={`/live?game=${game.id}`} className="pill live" onClick={(clickEvent) => clickEvent.stopPropagation()}>
              Live props →
            </Link>
          ) : modelEdge ? (
            <span className="pill positive">
              {modelEdge.sideLabel} · {formatNumber(modelEdge.evPercent, 1)}%
            </span>
          ) : showScores ? null : (
            <span className="faint small">No edge</span>
          )}
          {isPotentialBlowout(boxScore ?? game) ? <span className="pill warning">Blowout</span> : null}
        </div>
        <button
          className="slate-toggle"
          aria-expanded={open}
          aria-label={open ? "Hide details" : "Show injuries, opening line and every book"}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            setOpen((wasOpen) => !wasOpen);
          }}
        >
          {open ? "▲" : "▼"}
        </button>
      </div>
      {open ? (
        <div className="slate-extra">
          <div className="slate-extra-line">
            <span>
              Injuries <b>{injuryText || "none listed"}</b>
            </span>
            <span>
              Open{" "}
              <b>
                <Movement current={current.spreadHome} opening={opening.spreadHome} invertGood label={`${game.home_team.abbreviation} `} format={formatSpread} /> · <Movement current={current.total} opening={opening.total} />
              </b>
            </span>
            <span>
              {current.vendorCount} {current.vendorCount === 1 ? "book" : "books"}
            </span>
          </div>
          {injuryText ? (
            <div className="stack">
              {[game.visitor_team, game.home_team].map((team) => {
                const listed = teamInjuries(team.id);
                if (listed.length === 0) return null;
                return (
                  <div key={team.id} className="row wrap small">
                    <span className="strong">{team.abbreviation}</span>
                    {listed.map((injury) => (
                      <Link key={injury.player.id} href={`/player/${injury.player.id}`} className={`pill ${/out/i.test(injury.status) ? "negative" : "warning"}`} title={injury.description ?? ""}>
                        {injury.player.first_name.charAt(0)}. {injury.player.last_name} · {injury.status}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}
          <details>
            <summary className="expand-hint">Lines by book</summary>
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>{game.visitor_team.abbreviation} spr</th>
                    <th>{game.home_team.abbreviation} spr</th>
                    <th>Over</th>
                    <th>Under</th>
                    <th>{game.visitor_team.abbreviation} ML</th>
                    <th>{game.home_team.abbreviation} ML</th>
                  </tr>
                </thead>
                <tbody>
                  {odds.map((bettingOdd) => {
                    const cell = (selection: GameSelection, lineText: string | null, americanOdds: number | null) => {
                      const link = resolveSelectionLink(bettingOdd.deeplinks, selection, settings);
                      const content = (
                        <>
                          {lineText ? `${lineText} ` : ""}
                          <span className="sub">{formatAmerican(americanOdds)}</span>
                        </>
                      );
                      return link ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" title={link.kind === "selection" ? "Open bet in book" : "Open event in book"} style={{ textDecoration: "underline dotted" }}>
                          {content}
                        </a>
                      ) : (
                        content
                      );
                    };
                    return (
                      <tr key={bettingOdd.id}>
                        <td>{vendorLabel(bettingOdd.vendor)}</td>
                        <td>{cell("spread_away", formatSpread(bettingOdd.spread_away_value === null ? null : Number(bettingOdd.spread_away_value)), bettingOdd.spread_away_odds)}</td>
                        <td>{cell("spread_home", formatSpread(bettingOdd.spread_home_value === null ? null : Number(bettingOdd.spread_home_value)), bettingOdd.spread_home_odds)}</td>
                        <td>{cell("total_over", bettingOdd.total_value, bettingOdd.total_over_odds)}</td>
                        <td>{cell("total_under", bettingOdd.total_value, bettingOdd.total_under_odds)}</td>
                        <td>{cell("moneyline_away", null, bettingOdd.moneyline_away_odds)}</td>
                        <td>{cell("moneyline_home", null, bettingOdd.moneyline_home_odds)}</td>
                      </tr>
                    );
                  })}
                  {odds.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="faint">
                        No lines posted yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
