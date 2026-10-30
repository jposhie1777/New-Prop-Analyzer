"use client";

import { useState } from "react";
import { PriceButton } from "@/components/PriceButton";
import { BooksIndicator } from "@/components/BooksIndicator";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { bestEdgesByMarket, ConfidenceBreakdown, levelFilterText, LinesToolbar, marketTitles, meetsLevel, type LinesFilters } from "@/components/lines/LinesShared";
import { NcaabBoxScore, RatingHead, RatingRow, TeamName, matchesTeamSearch } from "@/components/ncaab/NcaabParts";
import { useSettings, useSlip } from "@/lib/client/hooks";
import { addPick, removePick } from "@/lib/client/betSlip";
import { buildNcaabGamePick, teamLabel, useNcaabSlate, type NcaabSlateGame } from "@/lib/client/ncaabData";
import { confidenceLevels, confidenceStep, confidenceWeights, type ConfidenceRating } from "@/lib/analytics/confidence";
import { implausibleEvPercent, type LineEdge } from "@/lib/analytics/gameModel";
import { ncaabHomeCourtPoints, ncaabOutcomeSpread, ncaabTooFarLimits, projectNcaabGame } from "@/lib/ncaab/ratings";
import { isNcaabFinal, isNcaabLive } from "@/lib/ncaab/types";
import { addDays, formatTipoff, todayEastern } from "@/lib/dates";
import { formatAmerican } from "@/lib/math/odds";
import { vendorLabel } from "@/lib/odds/deeplinks";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";

interface NcaabPlay {
  entry: NcaabSlateGame;
  edge: LineEdge;
  rating: ConfidenceRating | null;
}

function playsFor(entry: NcaabSlateGame, filters: LinesFilters): NcaabPlay[] {
  if (!entry.analysis) return [];
  return bestEdgesByMarket(entry.analysis.edges, filters.marketFilter)
    .filter((edge) => edge.flagged && edge.evPercent < implausibleEvPercent)
    .map((edge) => ({ entry, edge, rating: entry.analysis!.confidence.get(edge.selection) ?? null }))
    .filter((play) => meetsLevel(play.rating, filters.levelFilter))
    .sort((first, second) => (filters.sortKey === "ev" ? second.edge.evPercent - first.edge.evPercent : (second.rating?.score ?? 0) - (first.rating?.score ?? 0) || second.edge.evPercent - first.edge.evPercent));
}

function sortPlays(plays: NcaabPlay[], sortKey: LinesFilters["sortKey"]): NcaabPlay[] {
  return [...plays].sort((first, second) => {
    if (sortKey === "time") return first.entry.game.date.localeCompare(second.entry.game.date) || second.edge.evPercent - first.edge.evPercent;
    if (sortKey === "ev") return second.edge.evPercent - first.edge.evPercent;
    return (second.rating?.score ?? 0) - (first.rating?.score ?? 0) || second.edge.evPercent - first.edge.evPercent;
  });
}

function matchup(entry: NcaabSlateGame): string {
  return `${teamLabel(entry.game.visitor_team)} @ ${teamLabel(entry.game.home_team)}`;
}

function MinorEdge({ edge, entry, rating }: { edge: LineEdge; entry: NcaabSlateGame; rating: ConfidenceRating | null }) {
  const slip = useSlip();
  const gamePick = buildNcaabGamePick(entry.game, entry.odds, edge.selection, "ncaab-lines");
  const pick = gamePick ? { ...gamePick, modelProbability: edge.modelProbability } : null;
  const inSlip = pick ? slip.some((existing) => existing.pickId === pick.pickId) : false;
  return (
    <button className={`minor-edge${inSlip ? " selected" : ""}`} disabled={!pick} onClick={() => pick && (inSlip ? removePick(pick.pickId) : addPick(pick))} aria-pressed={inSlip} title={inSlip ? "Tap to remove from slip" : "Add to slip"}>
      <span>{marketTitles[edge.market]}</span>
      <strong>
        {inSlip ? "✓ " : ""}
        {edge.sideLabel}
      </strong>
      <span>
        {formatAmerican(edge.americanOdds)} · {edge.evPercent >= implausibleEvPercent ? "EV hidden" : `${formatSigned(edge.evPercent, 1)}%`}
      </span>
      {edge.flagged && rating ? <span className={`confidence-mini ${rating.level}`}>{rating.score}</span> : null}
    </button>
  );
}

function Verdict({ play, closest, filtersActive }: { play: NcaabPlay | null; closest: LineEdge | null; filtersActive: boolean }) {
  if (!play) {
    return (
      <div className="verdict none">
        <small>No edge</small>
        <b>{filtersActive ? "Nothing passes your filters" : "Model agrees with the market"}</b>
        <span>{closest ? `Closest: ${closest.sideLabel} at ${formatSigned(closest.evPercent, 1)}% EV` : "No lines posted yet."}</span>
      </div>
    );
  }
  const { edge, entry, rating } = play;
  const gamePick = buildNcaabGamePick(entry.game, entry.odds, edge.selection, "ncaab-lines");
  const pick = gamePick ? { ...gamePick, modelProbability: edge.modelProbability } : null;
  return (
    <div className="verdict">
      <div className="verdict-text">
        <span className="row" style={{ gap: 8 }}>
          <small>Best edge</small>
          <ConfidenceBadge rating={rating} />
        </span>
        <b>
          {edge.sideLabel} at {formatAmerican(edge.americanOdds)}
        </b>
        <span>
          {marketTitles[edge.market]}: model {edge.fairText} vs. {edge.marketText} · {formatSigned(edge.evPercent, 1)}% EV · {formatPercent(edge.modelProbability, 0)}
        </span>
      </div>
      <PriceButton pick={pick} sideLabel="" odds={edge.americanOdds} vendor={edge.vendor} note={edge.vendor ? vendorLabel(edge.vendor) : null} highlight compact />
    </div>
  );
}

function GameCard({ entry, verdict, filters, league }: { entry: NcaabSlateGame; verdict: NcaabPlay | null; filters: LinesFilters; league: { efficiency: number; tempo: number } }) {
  const { game, home, away, analysis } = entry;
  if (!analysis) return null;
  const { projection } = analysis;
  const bestByMarket = bestEdgesByMarket(analysis.edges, filters.marketFilter);
  const ranked = [...bestByMarket].sort((first, second) => second.evPercent - first.evPercent);
  const minorEdges = bestByMarket.filter((edge) => edge !== verdict?.edge);
  return (
    <article className="card flush">
      <div className="vcard">
        <div className="vcard-top">
          <span className="row" style={{ gap: 6 }}>
            {formatTipoff(game.date)}
            {game.postseason ? <span className="pill">Neutral</span> : null}
          </span>
          <span>Tempo {formatNumber(projection.pace, 1)}</span>
        </div>
        <div className="vcard-teams">
          {[
            { team: game.visitor_team, rated: away, points: projection.awayPoints },
            { team: game.home_team, rated: home, points: projection.homePoints },
          ].map(({ team, rated, points }) => (
            <div key={team.id} className="vcard-team">
              <TeamName teamId={team.id} college={team.college} rated={rated} />
              <span className="vcard-score">{formatNumber(points, 1)}</span>
            </div>
          ))}
        </div>
        <Verdict play={verdict} closest={ranked[0] ?? null} filtersActive={filters.marketFilter !== "all" || filters.levelFilter > 0} />
        {minorEdges.length > 0 ? (
          <div className="minor-edges">
            {minorEdges.map((edge) => (
              <MinorEdge key={edge.market} edge={edge} entry={entry} rating={analysis.confidence.get(edge.selection) ?? null} />
            ))}
          </div>
        ) : null}
      </div>
      <details className="card-foot-details">
        <summary>
          <span className="faint">Projected score</span>
          <span className="expand-hint">Why the model says this</span>
        </summary>
        <div className="card-foot-body">
          {verdict?.rating ? (
            <>
              <p className="small strong" style={{ margin: "0 0 6px" }}>
                Confidence in {verdict.edge.sideLabel}: {verdict.rating.score}/100
              </p>
              <ConfidenceBreakdown rating={verdict.rating} />
            </>
          ) : null}
          <p className="small" style={{ margin: 0 }}>
            Model: {teamLabel(game.home_team)} {formatSigned(-projection.margin, 1)}, total {formatNumber(projection.total, 1)}. {analysis.seasonOnlyProjection ? `This season alone: ${teamLabel(game.home_team)} ${formatSigned(-analysis.seasonOnlyProjection.margin, 1)}, total ${formatNumber(analysis.seasonOnlyProjection.total, 1)}.` : "Too few games this season for a season-only check."}
          </p>
          {home && away ? (
            <div className="table-scroll">
              <table className="data-table">
                <RatingHead />
                <tbody>
                  <RatingRow label={teamLabel(game.visitor_team)} rating={away.blended} league={league} />
                  <RatingRow label={teamLabel(game.home_team)} rating={home.blended} league={league} />
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="faint small" style={{ margin: 0 }}>
            Points per 100 possessions against an average opponent. Returning production: {away?.returningShare !== null && away?.returningShare !== undefined ? formatPercent(away.returningShare, 0) : "-"} / {home?.returningShare !== null && home?.returningShare !== undefined ? formatPercent(home.returningShare, 0) : "-"}.
          </p>
        </div>
      </details>
    </article>
  );
}

function ResultRow({ entry }: { entry: NcaabSlateGame }) {
  const [open, setOpen] = useState(false);
  const { game, home, away } = entry;
  const final = isNcaabFinal(game);
  const live = isNcaabLive(game);
  return (
    <div className="ledger-item">
      <div className="result-row" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={(keyEvent) => (keyEvent.key === "Enter" || keyEvent.key === " ") && setOpen(!open)} aria-expanded={open}>
        <span style={{ minWidth: 0 }}>
          <TeamName teamId={game.visitor_team.id} college={game.visitor_team.college} rated={away} /> <span className="strong tabular">{game.away_score ?? ""}</span>
          <span className="faint"> @ </span>
          <TeamName teamId={game.home_team.id} college={game.home_team.college} rated={home} /> <span className="strong tabular">{game.home_score ?? ""}</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {live ? <span className="pill live">{game.period_detail ?? game.status}</span> : <span className="faint small">{final ? "Final" : formatTipoff(game.date)}</span>}
          <span className="ledger-chevron">{open ? "▲" : "▼"}</span>
        </span>
      </div>
      {open ? <div className="ledger-extra">{final ? <NcaabBoxScore gameId={game.id} /> : <p className="faint small">Box scores are rebuilt the morning after the game.</p>}</div> : null}
    </div>
  );
}

function OtherGameRow({ entry, league }: { entry: NcaabSlateGame; league: { efficiency: number; tempo: number } }) {
  const { game, home, away } = entry;
  const projection = home && away ? projectNcaabGame(home.blended, away.blended, league, game.postseason) : null;
  return (
    <div className="result-row">
      <span style={{ minWidth: 0 }}>
        <TeamName teamId={game.visitor_team.id} college={game.visitor_team.college} rated={away} />
        <span className="faint"> @ </span>
        <TeamName teamId={game.home_team.id} college={game.home_team.college} rated={home} />
      </span>
      <span className="faint small tabular">
        {projection ? `${teamLabel(game.home_team)} ${formatSigned(-projection.margin, 1)} · ${formatNumber(projection.total, 1)} · ` : ""}
        {formatTipoff(game.date)}
      </span>
    </div>
  );
}

export default function NcaabLinesPage() {
  const settings = useSettings();
  const today = todayEastern();
  const [isoDate, setIsoDate] = useState(today);
  const [search, setSearch] = useState("");
  const [topOnly, setTopOnly] = useState(false);
  const [filters, setFilters] = useState<LinesFilters>({ view: "games", marketFilter: "all", levelFilter: 0, sortKey: "confidence" });
  const [openPlay, setOpenPlay] = useState<string | null>(null);
  const slate = useNcaabSlate(isoDate);
  const league = slate.ratings?.league ?? { efficiency: 104, tempo: 68 };

  const visible = slate.games.filter((entry) => {
    if (topOnly && !entry.home?.apRank && !entry.away?.apRank) return false;
    if (!search.trim()) return true;
    return matchesTeamSearch(search, entry.game.home_team) || matchesTeamSearch(search, entry.game.visitor_team) || String(entry.game.id) === search.trim();
  });
  const priced = visible.filter((entry) => entry.analysis);
  const started = visible.filter((entry) => isNcaabFinal(entry.game) || isNcaabLive(entry.game) || (!entry.analysis && new Date(entry.game.date).getTime() <= Date.now()));
  const unpriced = visible.filter((entry) => !entry.analysis && !started.includes(entry));
  const playsByGame = new Map(priced.map((entry) => [entry.game.id, playsFor(entry, filters)]));
  const allPlays = sortPlays(priced.flatMap((entry) => playsByGame.get(entry.game.id) ?? []), filters.sortKey);
  const gameCards = priced
    .map((entry) => ({ entry, verdict: playsByGame.get(entry.game.id)?.[0] ?? null }))
    .filter((card) => filters.levelFilter === 0 || card.verdict !== null)
    .sort((first, second) => {
      if (filters.sortKey === "time") return first.entry.game.date.localeCompare(second.entry.game.date);
      const valueOf = (card: typeof first) => (filters.sortKey === "ev" ? (card.verdict?.edge.evPercent ?? -99) : (card.verdict?.rating?.score ?? -1));
      return valueOf(second) - valueOf(first);
    });
  const lastPull = slate.oddsFile?.pulls.at(-1);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>College lines</h1>
          <p>
            {allPlays.length} play{allPlays.length === 1 ? "" : "s"} at {settings.evThresholdPercent}%+ EV{levelFilterText(filters.levelFilter)} · {visible.length} game{visible.length === 1 ? "" : "s"}
            {lastPull ? ` · odds from ${new Date(lastPull.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="row wrap">
          <BooksIndicator />
          <div className="day-nav">
            <button className="button ghost small" onClick={() => setIsoDate(addDays(isoDate, -1))} aria-label="Previous day">
              ‹
            </button>
            <button className="button ghost small" onClick={() => setIsoDate(today)} disabled={isoDate === today}>
              {isoDate === today ? "Today" : new Date(`${isoDate}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            </button>
            <button className="button ghost small" onClick={() => setIsoDate(addDays(isoDate, 1))} aria-label="Next day">
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="ncaab-search">
        <input className="input" type="search" placeholder="Search a team name or ID" value={search} onChange={(changeEvent) => setSearch(changeEvent.target.value)} aria-label="Search teams" />
        <label className="row small strong" style={{ gap: 6 }}>
          <input type="checkbox" checked={topOnly} onChange={(changeEvent) => setTopOnly(changeEvent.target.checked)} />
          Top 25 only{slate.ratings?.rankingsWeek ? ` (AP week ${slate.ratings.rankingsWeek})` : ""}
        </label>
      </div>
      <LinesToolbar filters={filters} onChange={setFilters} />
      {slate.error ? <div className="notice">Could not load games: {slate.error}</div> : null}
      {slate.loading && slate.games.length === 0 ? <div className="skeleton" style={{ minHeight: 200 }} /> : null}
      {!slate.loading && !slate.ratings ? <div className="notice">No ratings yet. They appear after the first NCAAB nightly data run.</div> : null}
      {!slate.loading && slate.games.length === 0 && !slate.error ? <div className="card empty-state">No college games on this day.</div> : null}
      {filters.view === "games" && gameCards.length > 0 ? (
        <div className="card-grid">
          {gameCards.map(({ entry, verdict }) => (
            <GameCard key={entry.game.id} entry={entry} verdict={verdict} filters={filters} league={league} />
          ))}
        </div>
      ) : null}
      {filters.view === "games" && priced.length > 0 && gameCards.length === 0 ? <div className="card empty-state">No games have a play that passes these filters.</div> : null}
      {filters.view === "plays" ? (
        <div className="card flush ledger-list plays-list">
          <div className="ledger-head" aria-hidden>
            <span>Confidence</span>
            <span>Play</span>
            <span className="hide-narrow">Game</span>
            <span className="numeric">EV</span>
            <span className="numeric hide-narrow">Chance</span>
            <span className="numeric">Price</span>
            <span />
          </div>
          {allPlays.map((play) => {
            const playKey = `${play.entry.game.id}-${play.edge.selection}`;
            const isOpen = openPlay === playKey;
            const gamePick = buildNcaabGamePick(play.entry.game, play.entry.odds, play.edge.selection, "ncaab-lines");
            const pick = gamePick ? { ...gamePick, modelProbability: play.edge.modelProbability } : null;
            return (
              <div key={playKey} className={`ledger-item${isOpen ? " open" : ""}`}>
                <div className="ledger-row" role="button" tabIndex={0} onClick={() => setOpenPlay(isOpen ? null : playKey)} onKeyDown={(keyEvent) => (keyEvent.key === "Enter" || keyEvent.key === " ") && setOpenPlay(isOpen ? null : playKey)} aria-expanded={isOpen}>
                  <span>
                    <ConfidenceBadge rating={play.rating} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="strong plays-name">{play.edge.sideLabel}</span>
                    <span className="faint small plays-meta">
                      {marketTitles[play.edge.market]} · model {play.edge.fairText}
                      <span className="show-narrow"> · {matchup(play.entry)}</span>
                    </span>
                  </span>
                  <span className="faint small hide-narrow">
                    {matchup(play.entry)} · {formatTipoff(play.entry.game.date).replace(" ET", "")}
                  </span>
                  <span className="numeric positive strong tabular">{formatSigned(play.edge.evPercent, 1)}%</span>
                  <span className="numeric hide-narrow tabular">{formatPercent(play.edge.modelProbability, 0)}</span>
                  <span className="numeric" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                    <PriceButton pick={pick} sideLabel="" odds={play.edge.americanOdds} vendor={play.edge.vendor} note={vendorLabel(play.edge.vendor)} highlight compact />
                  </span>
                  <span className="ledger-chevron">{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && play.rating ? (
                  <div className="ledger-extra">
                    <ConfidenceBreakdown rating={play.rating} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {allPlays.length === 0 ? <div className="empty-state">No plays pass these filters.</div> : null}
        </div>
      ) : null}
      {unpriced.length > 0 ? (
        <details className="card flush" style={{ marginTop: 12 }} open={priced.length === 0}>
          <summary className="result-row expand-hint">
            {unpriced.length} game{unpriced.length === 1 ? "" : "s"} without odds yet (model line shown)
          </summary>
          {unpriced.map((entry) => (
            <OtherGameRow key={entry.game.id} entry={entry} league={league} />
          ))}
        </details>
      ) : null}
      {started.length > 0 ? (
        <section style={{ marginTop: 12 }}>
          <h2 className="section-title">Scores and box scores</h2>
          <div className="card flush">
            {started.map((entry) => (
              <ResultRow key={entry.game.id} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}
      <details className="card" style={{ marginTop: 12 }}>
        <summary className="expand-hint">How the college model works</summary>
        <p className="faint small">
          Box scores are rebuilt every morning from BALLDONTLIE play-by-play (shots, rebounds, turnovers, free throws), which gives possessions and points per 100 possessions. Ratings are adjusted for opponent strength, so scoring 80 against a top defense counts for more than against a weak one. Before a team has played much, the model leans on last season, shrunk toward average by how much of last year&apos;s scoring is still on the roster (transfers count for their new school); this season&apos;s numbers take over as games are played (half weight after 6 games). Tempo = home tempo × away tempo ÷ league tempo; home court is worth {ncaabHomeCourtPoints} points, nothing on neutral floors (postseason). Results land about {ncaabOutcomeSpread.margin} points from the projected margin and {ncaabOutcomeSpread.total} from the total, which sets the cover chances. Edges more than {ncaabTooFarLimits.spread} points (spread), {ncaabTooFarLimits.total} (total) or {Math.round(ncaabTooFarLimits.winChance * 100)}% (moneyline) from the market usually mean news the model has not seen and are never flagged. Odds come from The Odds API three times a day (7:05 AM, 2:35 PM and 5:35 PM ET in winter, an hour later in daylight time).
        </p>
        <p className="faint small">
          Confidence uses the same {confidenceStep}-point scale as NBA: edge ({confidenceWeights.edge}), the full model and the this-season-only model agreeing ({confidenceWeights.agreement}), line movement since the morning pull ({confidenceWeights.movement}), the college record in that market ({confidenceWeights.record}) and games played ({confidenceWeights.data}). Tiers: very high {confidenceLevels["very-high"].minimum}+, high {confidenceLevels.high.minimum}+, medium {confidenceLevels.medium.minimum}+, low {confidenceLevels.low.minimum}+.
        </p>
      </details>
    </main>
  );
}
