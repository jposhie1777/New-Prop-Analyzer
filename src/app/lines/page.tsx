"use client";

import { TeamLogo } from "@/components/TeamLogo";
import { PriceButton } from "@/components/PriceButton";
import { BooksIndicator } from "@/components/BooksIndicator";
import { useSettings } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { useLineAnalyses, type GameAnalysis } from "@/lib/client/lineModel";
import { groupOddsByGame } from "@/lib/odds/consensus";
import type { LeagueRatings, TeamRating } from "@/lib/analytics/aggregates/teamRatings";
import { homeCourtPoints, implausibleEvPercent, injuryReplacementShare, marginDeviation, totalDeviation, type LineEdge } from "@/lib/analytics/gameModel";
import { learningPriors, type LearnedParameters } from "@/lib/analytics/lineLearning";
import { buildGamePick } from "@/lib/client/pickBuilders";
import { formatTipoff } from "@/lib/dates";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import type { BdlBettingOdd, BdlGame } from "@/lib/bdl/types";


const marketTitles: Record<LineEdge["market"], string> = { spread: "Spread", total: "Total", moneyline: "Moneyline" };

function RatingLine({ label, rating, league }: { label: string; rating: TeamRating; league: LeagueRatings }) {
  const sample = rating.current ?? rating.previous;
  return (
    <tr>
      <td className="strong">{label}</td>
      <td>
        {formatNumber(rating.blended.offense, 1)}
        <span className="sub"> {formatSigned(rating.blended.offense - league.offense, 1)}</span>
      </td>
      <td>
        {formatNumber(rating.blended.defense, 1)}
        <span className="sub"> {formatSigned(rating.blended.defense - league.offense, 1)}</span>
      </td>
      <td>{formatNumber(rating.blended.pace, 1)}</td>
      <td>{sample ? `${formatNumber(sample.pointsFor, 1)}-${formatNumber(sample.pointsAgainst, 1)}` : "–"}</td>
      <td>{rating.current?.games ?? 0}</td>
    </tr>
  );
}

function EdgeRow({ edge, game, odds }: { edge: LineEdge; game: BdlGame; odds: BdlBettingOdd[] }) {
  const gamePick = buildGamePick(game, odds, edge.selection, "lines");
  const pick = gamePick ? { ...gamePick, modelProbability: edge.modelProbability } : null; // the slip shows EV with the model's chance
  return (
    <div className={`line-edge-row${edge.flagged ? " flagged" : ""}`}>
      <div className="line-edge-market">
        <span className="section-label">{marketTitles[edge.market]}</span>
        <span className="small">
          Model <strong>{edge.fairText}</strong>
        </span>
        <span className="faint small">Market {edge.marketText}</span>
      </div>
      <div className="line-edge-pick">
        <PriceButton pick={pick} sideLabel={edge.sideLabel} odds={edge.americanOdds} vendor={edge.vendor} note={edge.evPercent >= implausibleEvPercent ? "EV hidden" : `${formatSigned(edge.evPercent, 1)}% EV · ${formatPercent(edge.modelProbability, 0)}`} highlight={edge.flagged} />
        {edge.tooFar ? <span className="warning-text small">{edge.evPercent >= implausibleEvPercent ? "Too good to be true: check news" : "Far from market: check news"}</span> : null}
      </div>
    </div>
  );
}

function GameEdgeCard({ analysis, league, odds, parameters }: { analysis: GameAnalysis; league: LeagueRatings; odds: BdlBettingOdd[]; parameters: LearnedParameters }) {
  const { game, projection, learned, edges, home, away, homeRest, awayRest } = analysis;
  const learnedHomePoints = (learned.total + learned.margin) / 2;
  const learnedAwayPoints = (learned.total - learned.margin) / 2;
  const bestByMarket = (["spread", "total", "moneyline"] as const).map((market) => edges.filter((edge) => edge.market === market).sort((first, second) => second.evPercent - first.evPercent)[0]).filter((edge): edge is LineEdge => Boolean(edge));
  return (
    <article className="card line-card">
      <div className="row-between">
        <span className="pill accent">{formatTipoff(game.datetime)}</span>
        <span className="row" style={{ gap: 6 }}>
          {awayRest?.backToBack ? <span className="pill warning">{game.visitor_team.abbreviation} B2B</span> : null}
          {homeRest?.backToBack ? <span className="pill warning">{game.home_team.abbreviation} B2B</span> : null}
        </span>
      </div>
      <div className="line-score">
        {[
          { team: game.visitor_team, points: learnedAwayPoints },
          { team: game.home_team, points: learnedHomePoints },
        ].map(({ team, points }) => (
          <div key={team.id} className="row-between">
            <span className="row">
              <TeamLogo teamId={team.id} />
              <span className="strong">{team.full_name}</span>
            </span>
            <span className="line-score-points">{formatNumber(points, 1)}</span>
          </div>
        ))}
        <div className="faint small">Projected score (learned) · pace {formatNumber(projection.pace, 1)} (league {formatNumber(league.pace, 1)})</div>
      </div>
      <div className="line-edges">
        {bestByMarket.map((edge) => (
          <EdgeRow key={edge.market} edge={edge} game={game} odds={odds} />
        ))}
        {bestByMarket.length === 0 ? <div className="faint small">No lines posted yet.</div> : null}
      </div>
      <details>
        <summary className="expand-hint">Why the model says this</summary>
        <p className="small" style={{ margin: "8px 0 0" }}>
          Original model: {game.home_team.abbreviation} {formatSigned(-projection.margin, 1)}, total {formatNumber(projection.total, 1)} ({formatNumber(projection.awayPoints, 1)}-{formatNumber(projection.homePoints, 1)}).
        </p>
        <p className="faint small" style={{ margin: "4px 0 0" }}>
          {parameters.sampleCount > 0 ? `Learned from ${parameters.sampleCount} finished games: ` : "No finished games learned from yet: "}
          bias {formatSigned(parameters.marginBias, 1)} margin / {formatSigned(parameters.totalBias, 1)} total, then {Math.round(parameters.marginTrust * 100)}% model and {100 - Math.round(parameters.marginTrust * 100)}% market on the spread, {Math.round(parameters.totalTrust * 100)}% model on the total.
        </p>
        <ul className="factor-list small">
          {projection.factors.map((factor) => (
            <li key={factor.label}>
              {factor.label}: <strong>{formatSigned(factor.marginEffect, 1)}</strong> margin{factor.totalEffect !== 0 ? `, ${formatSigned(factor.totalEffect, 1)} total` : ""}
            </li>
          ))}
        </ul>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Off rtg</th>
                <th>Def rtg</th>
                <th>Pace</th>
                <th>PF-PA</th>
                <th>GP</th>
              </tr>
            </thead>
            <tbody>
              <RatingLine label={game.visitor_team.abbreviation} rating={away} league={league} />
              <RatingLine label={game.home_team.abbreviation} rating={home} league={league} />
            </tbody>
          </table>
        </div>
        <p className="faint small">
          Ratings are points per 100 possessions (defense: allowed, lower is better), this season blended with last season until about 8 games in ({Math.round(home.currentWeight * 100)}% / {Math.round(away.currentWeight * 100)}% this season), tilted 30% toward the last 10 games.
        </p>
      </details>
    </article>
  );
}

export default function LinesPage() {
  const settings = useSettings();
  const slate = useSlate();
  const { analyses, ratings, ratingsLoading, gamesAhead, startedCount, parameters } = useLineAnalyses(slate); // also saves the daily model record
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const flaggedEdges = analyses.flatMap((analysis) => analysis.edges.filter((edge) => edge.flagged));

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Lines</h1>
          <p>
            Learned model spreads, totals and moneylines vs. the books. {flaggedEdges.length} edge{flaggedEdges.length === 1 ? "" : "s"} at {settings.evThresholdPercent}%+ EV.
          </p>
        </div>
        <BooksIndicator />
      </div>
      {slate.error ? <div className="notice">Could not load the slate: {slate.error}</div> : null}
      {ratingsLoading && !ratings ? <div className="skeleton" style={{ minHeight: 200 }} /> : null}
      {slate.data && gamesAhead === 0 ? <div className="card empty-state">No games left to tip off today.</div> : null}
      {startedCount > 0 ? <p className="faint small">{startedCount} game(s) already started or finished are hidden: this model is for pregame lines. Use Live for in-game props.</p> : null}
      <div className="grid-two">
        {ratings
          ? analyses.map((analysis) => <GameEdgeCard key={analysis.game.id} analysis={analysis} league={ratings} odds={oddsByGame.get(analysis.game.id) ?? []} parameters={parameters} />)
          : null}
      </div>
      <details className="card" style={{ marginTop: 12 }}>
        <summary className="expand-hint">How the model works</summary>
        <p className="faint small">
          Pace = home pace × away pace ÷ league pace. Each side scores pace × (its offense × the other defense ÷ league average) per 100 possessions. Then: home court +{homeCourtPoints}, a back-to-back costs 1.5 points of margin (and a little total), a rest edge of 2+ days adds 0.5, and each recent regular listed out, doubtful or questionable costs part of his scoring (teammates absorb about {Math.round(injuryReplacementShare * 100)}%). Learning: after each finished game the model compares itself with the opening line and the final score. It removes steady biases, learns how much of its disagreement with the market turned out right (that share is its trust; the rest comes from the market), and learns how widely results land around its line, which sets the cover and win chances. It only learns from earlier days, and small samples lean on the starting values ({Math.round(learningPriors.trust * 100)}% trust, {marginDeviation} and {totalDeviation} point spreads). EV uses each book&apos;s own line and price; green is at or above your threshold. When the model is more than 6 points (spread), 10 points (total) or 15% (moneyline) from the market it usually means news it has not seen, so those are never flagged; neither is any edge of {implausibleEvPercent}%+ EV, which is almost always missing news or a stale line. Markets are sharp: treat edges as leads, not locks.
        </p>
      </details>
    </main>
  );
}
