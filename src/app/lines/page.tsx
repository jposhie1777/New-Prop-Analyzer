"use client";

import { useEffect } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import { PriceButton } from "@/components/PriceButton";
import { BooksIndicator } from "@/components/BooksIndicator";
import { useAnalyticsQuery, useSettings } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { groupOddsByGame } from "@/lib/odds/consensus";
import { injuredScorers, teamRatings, type LeagueRatings, type TeamRating } from "@/lib/analytics/aggregates/teamRatings";
import { teamRest, type RestInfo } from "@/lib/analytics/aggregates/teamAggregates";
import { evaluateGameLines, homeCourtPoints, injuryReplacementShare, injuryWeight, projectGame, type GameProjection, type InjuryImpact, type LineEdge } from "@/lib/analytics/gameModel";
import { buildGamePick } from "@/lib/client/pickBuilders";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { lineEdgeToTracked } from "@/lib/tracking/fromSources";
import { isGameFinal, isGameLive } from "@/lib/data/flatten";
import { formatTipoff, todayEastern } from "@/lib/dates";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { appSettings } from "@/config/appSettings";
import type { BdlBettingOdd, BdlGame, BdlPlayerInjury } from "@/lib/bdl/types";

const injuryMinimumMinutes = 15; // bench players barely move a team total

interface GameAnalysis {
  game: BdlGame;
  projection: GameProjection;
  edges: LineEdge[];
  home: TeamRating;
  away: TeamRating;
  homeRest: RestInfo | undefined;
  awayRest: RestInfo | undefined;
  bestEv: number;
}

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
        <PriceButton pick={pick} sideLabel={edge.sideLabel} odds={edge.americanOdds} vendor={edge.vendor} note={`${formatSigned(edge.evPercent, 1)}% EV · ${formatPercent(edge.modelProbability, 0)}`} highlight={edge.flagged} />
        {edge.tooFar ? <span className="warning-text small">Far from market: check news</span> : null}
      </div>
    </div>
  );
}

function GameEdgeCard({ analysis, league, odds }: { analysis: GameAnalysis; league: LeagueRatings; odds: BdlBettingOdd[] }) {
  const { game, projection, edges, home, away, homeRest, awayRest } = analysis;
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
          { team: game.visitor_team, points: projection.awayPoints },
          { team: game.home_team, points: projection.homePoints },
        ].map(({ team, points }) => (
          <div key={team.id} className="row-between">
            <span className="row">
              <TeamLogo teamId={team.id} />
              <span className="strong">{team.full_name}</span>
            </span>
            <span className="line-score-points">{formatNumber(points, 1)}</span>
          </div>
        ))}
        <div className="faint small">Projected score · pace {formatNumber(projection.pace, 1)} (league {formatNumber(league.pace, 1)})</div>
      </div>
      <div className="line-edges">
        {bestByMarket.map((edge) => (
          <EdgeRow key={edge.market} edge={edge} game={game} odds={odds} />
        ))}
        {bestByMarket.length === 0 ? <div className="faint small">No lines posted yet.</div> : null}
      </div>
      <details>
        <summary className="expand-hint">Why the model says this</summary>
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

function injuriesFor(teamId: number, injuries: BdlPlayerInjury[], scorers: Map<number, { teamId: number; pointsPerGame: number; minutesPerGame: number; playedRecently: boolean }> | null): InjuryImpact[] {
  if (!scorers) return [];
  return injuries.flatMap((injury) => {
    const scorer = scorers.get(injury.player.id);
    const weight = injuryWeight(injury.status);
    if (!scorer || scorer.teamId !== teamId || weight === 0 || !scorer.playedRecently || scorer.minutesPerGame < injuryMinimumMinutes) return []; // long absences are already in the team numbers
    return [{ playerName: `${injury.player.first_name.charAt(0)}. ${injury.player.last_name}`, status: injury.status, pointsLost: scorer.pointsPerGame * weight * (1 - injuryReplacementShare) }];
  });
}

export default function LinesPage() {
  const settings = useSettings();
  const slate = useSlate();
  const today = todayEastern();
  const games = (slate.data?.games ?? []).filter((game) => !isGameFinal(game) && !isGameLive(game)); // the model is pregame only
  const startedCount = (slate.data?.games ?? []).length - games.length;
  const teamIds = games.flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const injuredIds = (slate.data?.injuries ?? []).map((injury) => injury.player.id);
  const ratings = useAnalyticsQuery((handle) => teamRatings(handle.engine, appSettings.currentSeason), `ratings:${today}`);
  const rest = useAnalyticsQuery(teamIds.length > 0 ? (handle) => teamRest(handle.engine, teamIds, today) : null, `lines-rest:${today}:${teamIds.join(",")}`);
  const scorers = useAnalyticsQuery(injuredIds.length > 0 ? (handle) => injuredScorers(handle.engine, injuredIds, appSettings.currentSeason) : null, `lines-injuries:${injuredIds.join(",")}`);
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);

  const analyses: GameAnalysis[] = [];
  if (ratings.result) {
    for (const game of games) {
      const home = ratings.result.teams.get(game.home_team.id);
      const away = ratings.result.teams.get(game.visitor_team.id);
      if (!home || !away) continue;
      const homeRest = rest.result?.get(game.home_team.id);
      const awayRest = rest.result?.get(game.visitor_team.id);
      const projection = projectGame(home, away, ratings.result, {
        homeRest,
        awayRest,
        homeInjuries: injuriesFor(game.home_team.id, slate.data?.injuries ?? [], scorers.result),
        awayInjuries: injuriesFor(game.visitor_team.id, slate.data?.injuries ?? [], scorers.result),
      });
      const edges = evaluateGameLines(projection, oddsByGame.get(game.id) ?? [], game.home_team.abbreviation, game.visitor_team.abbreviation, settings.evThresholdPercent);
      analyses.push({ game, projection, edges, home, away, homeRest, awayRest, bestEv: Math.max(-Infinity, ...edges.filter((edge) => edge.flagged).map((edge) => edge.evPercent)) });
    }
  }
  analyses.sort((first, second) => second.bestEv - first.bestEv || (first.game.datetime ?? "").localeCompare(second.game.datetime ?? ""));
  const flaggedEdges = analyses.flatMap((analysis) => analysis.edges.filter((edge) => edge.flagged).map((edge) => ({ edge, game: analysis.game })));
  const flaggedKey = flaggedEdges.map(({ edge, game }) => `${game.id}:${edge.selection}`).join(",");
  useEffect(() => {
    if (flaggedEdges.length > 0) trackPicks(flaggedEdges.map(({ edge, game }) => lineEdgeToTracked(edge, game.id, game.date))); // graded on the Record page
  }, [flaggedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Lines</h1>
          <p>
            Model spreads, totals and moneylines vs. the books. {flaggedEdges.length} edge{flaggedEdges.length === 1 ? "" : "s"} at {settings.evThresholdPercent}%+ EV.
          </p>
        </div>
        <BooksIndicator />
      </div>
      {slate.error ? <div className="notice">Could not load the slate: {slate.error}</div> : null}
      {ratings.loading && !ratings.result ? <div className="skeleton" style={{ minHeight: 200 }} /> : null}
      {slate.data && games.length === 0 ? <div className="card empty-state">No games left to tip off today.</div> : null}
      {startedCount > 0 ? <p className="faint small">{startedCount} game(s) already started or finished are hidden: this model is for pregame lines. Use Live for in-game props.</p> : null}
      <div className="grid-two">
        {ratings.result
          ? analyses.map((analysis) => <GameEdgeCard key={analysis.game.id} analysis={analysis} league={ratings.result!} odds={oddsByGame.get(analysis.game.id) ?? []} />)
          : null}
      </div>
      <details className="card" style={{ marginTop: 12 }}>
        <summary className="expand-hint">How the model works</summary>
        <p className="faint small">
          Pace = home pace × away pace ÷ league pace. Each side scores pace × (its offense × the other defense ÷ league average) per 100 possessions. Then: home court +{homeCourtPoints}, a back-to-back costs 1.5 points of margin (and a little total), a rest edge of 2+ days adds 0.5, and each recent regular listed out, doubtful or questionable costs part of his scoring (teammates absorb about {Math.round(injuryReplacementShare * 100)}%). Win and cover chances use a normal spread of 12.5 points on the margin and 17 on the total. EV uses each book&apos;s own line and price; green is at or above your threshold. When the model is more than 6 points (spread), 10 points (total) or 15% (moneyline) from the market it usually means news it has not seen, so those are never flagged. Markets are sharp: treat edges as leads, not locks.
        </p>
      </details>
    </main>
  );
}
