"use client";

import Link from "next/link";
import { TeamLogo } from "@/components/TeamLogo";
import { AddToSlipButton } from "@/components/AddToSlipButton";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlayerInjury } from "@/lib/bdl/types";
import { consensusLine } from "@/lib/odds/consensus";
import { buildGamePick, formatSpread, type GameSelection } from "@/lib/client/pickBuilders";
import { formatAmerican } from "@/lib/math/odds";
import { formatTipoff } from "@/lib/dates";
import { isGameFinal, isGameLive } from "@/lib/data/flatten";
import type { RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import { resolveSelectionLink, vendorLabel } from "@/lib/odds/deeplinks";
import { useSettings } from "@/lib/client/hooks";
import { clockLabel } from "@/lib/analytics/liveProjection";

function Movement({ current, opening, invertGood = false }: { current: number | null; opening: number | null; invertGood?: boolean }) {
  if (current === null || opening === null) return <span className="faint">open -</span>;
  const delta = Math.round((current - opening) * 10) / 10;
  if (delta === 0) return <span className="faint">open {opening} · no move</span>;
  const goodDirection = invertGood ? delta < 0 : delta > 0;
  return (
    <span className={goodDirection ? "positive" : "negative"}>
      open {opening} {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
    </span>
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
  return <span className="pill accent">{formatTipoff(game.datetime)}</span>;
}

export function GameCard({ game, odds, openingOdds, injuries, rest, boxScore }: { game: BdlGame; odds: BdlBettingOdd[]; openingOdds: BdlBettingOdd[]; injuries: BdlPlayerInjury[]; rest: Map<number, RestInfo> | null; boxScore: BdlBoxScore | null }) {
  const settings = useSettings();
  const current = consensusLine(odds);
  const opening = consensusLine(openingOdds);
  const live = isGameLive(boxScore ?? game) || isGameFinal(boxScore ?? game);
  const homeScore = boxScore?.home_team_score ?? game.home_team_score;
  const visitorScore = boxScore?.visitor_team_score ?? game.visitor_team_score;
  const pick = (selection: GameSelection) => buildGamePick(game, odds, selection, "slate");
  const teamInjuries = (teamId: number) => injuries.filter((injury) => injury.player.team?.id === teamId || injury.player.team_id === teamId);
  return (
    <article className="card game-card">
      <div className="game-card-top">
        {statusLine(game, boxScore)}
        <span className="row">
          <RestBadge rest={rest?.get(game.visitor_team.id)} />
          <span className="faint">vs</span>
          <RestBadge rest={rest?.get(game.home_team.id)} />
        </span>
      </div>
      <div className="game-matchup">
        {[game.visitor_team, game.home_team].map((team, teamIndex) => (
          <div key={team.id} style={{ display: "contents" }}>
            <div className="team-line">
              <TeamLogo teamId={team.id} />
              <span className="team-name">{team.full_name}</span>
              {teamIndex === 1 ? <span className="faint small">home</span> : null}
            </div>
            <div className="team-score">{live ? (teamIndex === 0 ? visitorScore : homeScore) : ""}</div>
          </div>
        ))}
      </div>
      <div className="odds-strip">
        <div className="odds-cell">
          <div className="section-label">Spread</div>
          <div className="odds-main">
            {game.home_team.abbreviation} {formatSpread(current.spreadHome)}
          </div>
          <div className="odds-move">
            <Movement current={current.spreadHome} opening={opening.spreadHome} invertGood />
          </div>
        </div>
        <div className="odds-cell">
          <div className="section-label">Total</div>
          <div className="odds-main">{current.total ?? "-"}</div>
          <div className="odds-move">
            <Movement current={current.total} opening={opening.total} />
          </div>
        </div>
        <div className="odds-cell">
          <div className="section-label">Moneyline</div>
          <div className="odds-main">
            {formatAmerican(current.moneylineAway)} / {formatAmerican(current.moneylineHome)}
          </div>
          <div className="odds-move faint">{current.vendorCount} {current.vendorCount === 1 ? "book" : "books"}</div>
        </div>
      </div>
      <div className="card-body" style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)" }}>
        {isGameLive(boxScore ?? game) ? (
          <Link href={`/live?game=${game.id}`} className="button primary" style={{ width: "100%", marginBottom: 10 }}>
            Live player props →
          </Link>
        ) : null}
        <div className="chip-row">
          <AddToSlipButton pick={pick("spread_away")} label={`+ ${game.visitor_team.abbreviation} spread`} />
          <AddToSlipButton pick={pick("spread_home")} label={`+ ${game.home_team.abbreviation} spread`} />
          <AddToSlipButton pick={pick("total_over")} label="+ Over" />
          <AddToSlipButton pick={pick("total_under")} label="+ Under" />
          <AddToSlipButton pick={pick("moneyline_away")} label={`+ ${game.visitor_team.abbreviation} ML`} />
          <AddToSlipButton pick={pick("moneyline_home")} label={`+ ${game.home_team.abbreviation} ML`} />
        </div>
        {[game.visitor_team, game.home_team].some((team) => teamInjuries(team.id).length > 0) ? (
          <div className="stack" style={{ marginTop: 10 }}>
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
        <details style={{ marginTop: 10 }}>
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
    </article>
  );
}
