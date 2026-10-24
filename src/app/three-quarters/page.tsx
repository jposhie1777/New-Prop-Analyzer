"use client";

import { TeamLogo } from "@/components/TeamLogo";
import { SyncStatus } from "@/components/SyncStatus";
import { useAnalyticsQuery } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { consensusLine, groupOddsByGame, impliedTeamTotals } from "@/lib/odds/consensus";
import { estimateThreeQuarterShare, pickDeviation, projectThreeQuarters, threeQuarterProfiles, type ThreeQuarterSeasonProfile } from "@/lib/analytics/aggregates/threeQuarters";
import type { WindowName } from "@/lib/analytics/aggregates/windows";
import { appSettings } from "@/config/appSettings";
import { formatNumber, formatPercent } from "@/lib/client/format";
import { formatTipoff } from "@/lib/dates";
import type { BdlGame } from "@/lib/bdl/types";
import { useEffect } from "react";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { threeQuarterToTracked } from "@/lib/tracking/fromSources";

interface SheetRow {
  game: BdlGame;
  teamId: number;
  opponentId: number;
  isHome: boolean;
  impliedTotal: number | null;
  lineSource: string;
  share: ReturnType<typeof estimateThreeQuarterShare>;
  projection: ReturnType<typeof projectThreeQuarters>;
  teamProfile: ThreeQuarterSeasonProfile | undefined;
  opponentProfile: ThreeQuarterSeasonProfile | undefined;
  profileSeason: number;
}

function pickProfile(profiles: ThreeQuarterSeasonProfile[], teamId: number): { profile: ThreeQuarterSeasonProfile | undefined; previous: ThreeQuarterSeasonProfile | undefined; season: number } {
  const current = profiles.find((profile) => profile.teamId === teamId && profile.season === appSettings.currentSeason);
  const previous = profiles.find((profile) => profile.teamId === teamId && profile.season === appSettings.lastSeason);
  if (current && current.scored.SEASON.games > 0) return { profile: current, previous, season: appSettings.currentSeason };
  return { profile: previous, previous, season: appSettings.lastSeason }; // no games yet this season
}

function windowCell(summary: { average: number | null; games: number } | undefined) {
  return (
    <>
      {formatNumber(summary?.average ?? null)}
      <span className="sub">{summary?.games ?? 0}g</span>
    </>
  );
}

function rateCell(hits: number | undefined, games: number | undefined) {
  if (!games) return "-";
  return (
    <>
      {formatPercent((hits ?? 0) / games)}
      <span className="sub">
        {hits ?? 0}/{games}
      </span>
    </>
  );
}

export default function ThreeQuartersPage() {
  const slate = useSlate();
  const games = slate.data?.games ?? [];
  const teamIds = games.flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const profiles = useAnalyticsQuery(teamIds.length > 0 ? (handle) => threeQuarterProfiles(handle.engine, teamIds, [appSettings.currentSeason, appSettings.lastSeason]) : null, teamIds.join(","));
  const oddsByGame = groupOddsByGame(slate.data?.odds ?? []);
  const openingByGame = groupOddsByGame(slate.data?.openingOdds ?? []);

  const rows: SheetRow[] = [];
  for (const game of games) {
    const liveLine = consensusLine(oddsByGame.get(game.id) ?? []);
    const openLine = consensusLine(openingByGame.get(game.id) ?? []);
    const useLine = liveLine.total !== null && liveLine.spreadHome !== null ? liveLine : openLine;
    const implied = impliedTeamTotals(useLine.spreadHome, useLine.total);
    for (const isHome of [false, true]) {
      const teamId = isHome ? game.home_team.id : game.visitor_team.id;
      const opponentId = isHome ? game.visitor_team.id : game.home_team.id;
      const allProfiles = profiles.result ?? [];
      const teamPick = pickProfile(allProfiles, teamId);
      const opponentPick = pickProfile(allProfiles, opponentId);
      const current = allProfiles.find((profile) => profile.teamId === teamId && profile.season === appSettings.currentSeason);
      const share = estimateThreeQuarterShare(current, teamPick.previous);
      const deviation = pickDeviation(current, teamPick.previous);
      const impliedTotal = isHome ? implied.home : implied.away;
      rows.push({
        game,
        teamId,
        opponentId,
        isHome,
        impliedTotal,
        lineSource: useLine === liveLine ? "current" : "opening",
        share,
        projection: projectThreeQuarters(impliedTotal, share.share, deviation),
        teamProfile: teamPick.profile,
        opponentProfile: opponentPick.profile,
        profileSeason: teamPick.season,
      });
    }
  }
  rows.sort((first, second) => (second.projection.probability ?? -1) - (first.projection.probability ?? -1));
  const windows: WindowName[] = ["L5", "L10", "L20"];
  const trackable = rows.filter((row) => row.projection.probability !== null && row.projection.projection !== null && row.game.status_state === "scheduled");
  const trackKey = trackable.map((row) => `${row.game.id}:${row.teamId}`).join(",");
  useEffect(() => {
    trackPicks(trackable.map((row) => threeQuarterToTracked(row.game.id, row.game.date, row.teamId, (row.isHome ? row.game.home_team : row.game.visitor_team).abbreviation, (row.isHome ? row.game.visitor_team : row.game.home_team).abbreviation, row.projection.probability!, row.projection.projection!))); // pregame projections only
  }, [trackKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <div className="mobile-sync">
        <SyncStatus />
      </div>
      <div className="page-title">
        <div>
          <h1>100 in 3 Quarters</h1>
          <p>Projection = implied team total (spread + total) × the team&apos;s share of points scored in Q1-Q3. Probability uses a normal approximation.</p>
        </div>
      </div>
      {games.length === 0 && !slate.loading ? <div className="card empty-state">No games today.</div> : null}
      {profiles.loading && games.length > 0 ? <div className="skeleton" /> : null}
      <div className="stack" style={{ gap: 10 }}>
        {rows.map((row, rowIndex) => {
          const teamName = row.isHome ? row.game.home_team : row.game.visitor_team;
          const opponentName = row.isHome ? row.game.visitor_team : row.game.home_team;
          const probability = row.projection.probability;
          return (
            <details key={`${row.game.id}-${row.teamId}`} className="card" style={{ marginTop: 0 }}>
              <summary>
                <div className="row-between">
                  <div className="row" style={{ minWidth: 0 }}>
                    <span className="faint tabular" style={{ width: 22 }}>
                      {rowIndex + 1}
                    </span>
                    <TeamLogo teamId={row.teamId} />
                    <div style={{ minWidth: 0 }}>
                      <div className="strong">
                        {teamName.abbreviation} <span className="faint">{row.isHome ? "vs" : "@"}</span> {opponentName.abbreviation}
                      </div>
                      <div className="faint small">{formatTipoff(row.game.datetime)}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 14 }}>
                    <div style={{ textAlign: "right" }}>
                      <div className="strong tabular">{formatNumber(row.projection.projection)}</div>
                      <div className="faint small">proj thru 3</div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 64 }}>
                      <div className={`strong tabular ${probability !== null && probability >= 0.5 ? "positive" : ""}`}>{formatPercent(probability, 1)}</div>
                      <div className="faint small">P(100+)</div>
                    </div>
                  </div>
                </div>
                <div className="meter" style={{ marginTop: 10 }}>
                  <span style={{ width: `${Math.round((probability ?? 0) * 100)}%` }} />
                </div>
                <div className="row wrap small" style={{ marginTop: 8, gap: 6 }}>
                  <span className="pill">implied {formatNumber(row.impliedTotal)}</span>
                  <span className="pill">Q1-Q3 share {formatPercent(row.share.share, 1)}</span>
                  <span className="pill">σ {formatNumber(row.projection.standardDeviation)}</span>
                  <span className="pill">scored 100+ L20 {rateCell(row.teamProfile?.scoredHundred.L20, row.teamProfile?.scored.L20.games)}</span>
                  <span className="pill">opp allowed 100+ L20 {rateCell(row.opponentProfile?.allowedHundred.L20, row.opponentProfile?.allowed.L20.games)}</span>
                  <span className="expand-hint">All inputs ▾</span>
                </div>
              </summary>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Input ({row.profileSeason})</th>
                      {windows.map((windowName) => (
                        <th key={windowName}>{windowName}</th>
                      ))}
                      <th>Season</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{teamName.abbreviation} Q1-Q3 scored</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(row.teamProfile?.scored[windowName])}</td>
                      ))}
                      <td>{windowCell(row.teamProfile?.scored.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} Q1-Q3 allowed</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(row.opponentProfile?.allowed[windowName])}</td>
                      ))}
                      <td>{windowCell(row.opponentProfile?.allowed.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{teamName.abbreviation} pace</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(row.teamProfile?.pace[windowName])}</td>
                      ))}
                      <td>{windowCell(row.teamProfile?.pace.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} pace</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(row.opponentProfile?.pace[windowName])}</td>
                      ))}
                      <td>{windowCell(row.opponentProfile?.pace.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{teamName.abbreviation} scored 100+ thru 3</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{rateCell(row.teamProfile?.scoredHundred[windowName], row.teamProfile?.scored[windowName].games)}</td>
                      ))}
                      <td>{rateCell(row.teamProfile?.scoredHundred.SEASON, row.teamProfile?.scored.SEASON.games)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} allowed 100+ thru 3</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{rateCell(row.opponentProfile?.allowedHundred[windowName], row.opponentProfile?.allowed[windowName].games)}</td>
                      ))}
                      <td>{rateCell(row.opponentProfile?.allowedHundred.SEASON, row.opponentProfile?.allowed.SEASON.games)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="faint small" style={{ marginBottom: 0 }}>
                Line: {row.lineSource} consensus · share from {row.share.source} ({row.share.games} games) · P(100+) = 1 − Φ((99.5 − {formatNumber(row.projection.projection)}) / {formatNumber(row.projection.standardDeviation)})
              </p>
            </details>
          );
        })}
      </div>
    </main>
  );
}
