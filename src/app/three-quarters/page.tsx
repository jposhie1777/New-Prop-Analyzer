"use client";

import { TeamLogo } from "@/components/TeamLogo";
import { SyncStatus } from "@/components/SyncStatus";
import { useAnalyticsQuery, useSettings } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { consensusLine, groupOddsByGame, impliedTeamTotals } from "@/lib/odds/consensus";
import { rateTeamForGame, selectThreeQuarterRecommendations, threeQuarterProfiles, type TeamThreeQuarterRating } from "@/lib/analytics/aggregates/threeQuarters";
import { calibrateRating } from "@/lib/analytics/threeQuarterLearning";
import { useThreeQuarterCalibration } from "@/lib/client/lineModel";
import type { WindowName } from "@/lib/analytics/aggregates/windows";
import { appSettings } from "@/config/appSettings";
import { formatNumber, formatPercent } from "@/lib/client/format";
import { formatTipoff } from "@/lib/dates";
import type { BdlGame } from "@/lib/bdl/types";
import { useEffect } from "react";
import { pruneThreeQuarterPicks, readTracked, trackPicks } from "@/lib/tracking/trackerStore";
import { threeQuarterToTracked } from "@/lib/tracking/fromSources";

interface SheetRow extends TeamThreeQuarterRating {
  game: BdlGame;
  teamId: number;
  opponentId: number;
  isHome: boolean;
  impliedTotal: number | null;
  lineSource: string;
  rawRating: number | null; // before learning
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
  const settings = useSettings();
  const slate = useSlate();
  const games = slate.data?.games ?? [];
  const teamIds = games.flatMap((game) => [game.home_team.id, game.visitor_team.id]);
  const profiles = useAnalyticsQuery(teamIds.length > 0 ? (handle) => threeQuarterProfiles(handle.engine, teamIds, [appSettings.currentSeason, appSettings.lastSeason]) : null, teamIds.join(","));
  const calibration = useThreeQuarterCalibration();
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
      const rated = rateTeamForGame(profiles.result ?? [], teamId, opponentId, isHome ? implied.home : implied.away, appSettings.currentSeason);
      rows.push({
        game,
        teamId,
        opponentId,
        isHome,
        impliedTotal: isHome ? implied.home : implied.away,
        lineSource: useLine === liveLine ? "current" : "opening",
        ...rated,
        rawRating: rated.rating,
        rating: rated.rating === null ? null : calibrateRating(rated.rating, calibration), // learned from this season's finished games
      });
    }
  }
  rows.sort((first, second) => (second.rating ?? -1) - (first.rating ?? -1));
  const windows: WindowName[] = ["L5", "L10", "L20"];
  const minimumRating = settings.threeQuarterMinimumPercent / 100;
  const recommended = selectThreeQuarterRecommendations(rows, minimumRating, settings.threeQuarterMaxPicks);
  const trackable = rows.filter((sheetRow) => recommended.has(sheetRow) && sheetRow.projection.projection !== null && sheetRow.game.status_state === "scheduled");
  const trackKey = trackable.map((sheetRow) => `${sheetRow.game.id}:${sheetRow.teamId}`).join(",");
  useEffect(() => {
    pruneThreeQuarterPicks((minimumRating - 0.4 * appSettings.hundredThroughThreeBaseRate) / 0.6, settings.threeQuarterMaxPicks); // once: older records held every team, scored by raw chance
    const trackIdOf = (sheetRow: SheetRow) => `t3-${sheetRow.game.id}-${sheetRow.teamId}`;
    const trackedToday = readTracked().filter((pick) => pick.source === "100-in-3" && pick.gameDate === slate.data?.date);
    const trackedIds = new Set(trackedToday.map((pick) => pick.trackId));
    const room = Math.max(0, settings.threeQuarterMaxPicks - trackedToday.length); // the first recommendations of the day are the ones graded
    const fresh = trackable.filter((sheetRow) => !trackedIds.has(trackIdOf(sheetRow))).slice(0, room);
    trackPicks(fresh.map((sheetRow) => threeQuarterToTracked(sheetRow.game.id, sheetRow.game.date, sheetRow.teamId, (sheetRow.isHome ? sheetRow.game.home_team : sheetRow.game.visitor_team).abbreviation, (sheetRow.isHome ? sheetRow.game.visitor_team : sheetRow.game.home_team).abbreviation, sheetRow.rating!, sheetRow.projection.projection!))); // recommendations only, pregame
  }, [trackKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <div className="mobile-sync">
        <SyncStatus />
      </div>
      <div className="page-title">
        <div>
          <h1>100 in 3 Quarters</h1>
          <p>
            Learned chance = the rating below, corrected by how ratings have actually played out this season. Rating = 60% line-based chance (implied team total × the team&apos;s Q1-Q3 share) + 20% how often the team has scored 100+ through three lately + 20% how often the opponent has allowed it. Recommended: learned chance {settings.threeQuarterMinimumPercent}%+, best {settings.threeQuarterMaxPicks} per day; only these are graded on the Record page. League-wide, about {Math.round(appSettings.hundredThroughThreeBaseRate * 100)}% of teams get there.
          </p>
        </div>
      </div>
      <section className="card" style={{ marginTop: 0, marginBottom: 10 }}>
        <div className="row-between wrap" style={{ gap: 8 }}>
          <span className="strong">What it has learned</span>
          <span className="faint small">{calibration.sampleCount} team-games this season</span>
        </div>
        <p className="faint small" style={{ margin: "6px 0 0" }}>
          {calibration.sampleCount === 0
            ? "No finished games yet: ratings are used as they are."
            : `Teams rated ${formatPercent(calibration.averageRating, 0)} on average hit 100 through three ${formatPercent(calibration.hitRate, 0)} of the time. A 30% rating now means ${formatPercent(calibrateRating(0.3, calibration), 0)} and a 20% rating means ${formatPercent(calibrateRating(0.2, calibration), 0)}. It learns only from earlier days and moves slowly until it has a few hundred games.`}
        </p>
      </section>
      {games.length === 0 && !slate.loading ? <div className="card empty-state">No games today.</div> : null}
      {profiles.loading && games.length > 0 ? <div className="skeleton" /> : null}
      <div className="stack" style={{ gap: 10 }}>
        {rows.map((sheetRow, rowIndex) => {
          const teamName = sheetRow.isHome ? sheetRow.game.home_team : sheetRow.game.visitor_team;
          const opponentName = sheetRow.isHome ? sheetRow.game.visitor_team : sheetRow.game.home_team;
          const probability = sheetRow.rating;
          const isRecommended = recommended.has(sheetRow);
          return (
            <details key={`${sheetRow.game.id}-${sheetRow.teamId}`} className={`card${isRecommended ? " recommended-card" : ""}`} style={{ marginTop: 0 }}>
              <summary>
                <div className="row-between">
                  <div className="row" style={{ minWidth: 0 }}>
                    <span className="faint tabular" style={{ width: 22 }}>
                      {rowIndex + 1}
                    </span>
                    <TeamLogo teamId={sheetRow.teamId} />
                    <div style={{ minWidth: 0 }}>
                      <div className="strong">
                        {teamName.abbreviation} <span className="faint">{sheetRow.isHome ? "vs" : "@"}</span> {opponentName.abbreviation}
                      </div>
                      <div className="faint small">
                        {formatTipoff(sheetRow.game.datetime)}
                        {isRecommended ? <span className="pill positive" style={{ marginLeft: 6 }}>Recommended</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 14 }}>
                    <div style={{ textAlign: "right" }}>
                      <div className="strong tabular">{formatNumber(sheetRow.projection.projection)}</div>
                      <div className="faint small">proj thru 3</div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 64 }}>
                      <div className={`strong tabular ${isRecommended ? "positive" : ""}`}>{formatPercent(probability, 1)}</div>
                      <div className="faint small">chance</div>
                    </div>
                  </div>
                </div>
                <div className="meter" style={{ marginTop: 10 }}>
                  <span style={{ width: `${Math.round((probability ?? 0) * 100)}%` }} />
                </div>
                <div className="row wrap small" style={{ marginTop: 8, gap: 6 }}>
                  <span className="pill">line chance {formatPercent(sheetRow.projection.probability, 0)}</span>
                  <span className="pill">rating {formatPercent(sheetRow.rawRating, 0)} → learned {formatPercent(sheetRow.rating, 0)}</span>
                  <span className="pill">implied {formatNumber(sheetRow.impliedTotal)}</span>
                  <span className="pill">Q1-Q3 share {formatPercent(sheetRow.share.share, 1)}</span>
                  <span className="pill">σ {formatNumber(sheetRow.projection.standardDeviation)}</span>
                  <span className="pill">scored 100+ L20 {rateCell(sheetRow.teamProfile?.scoredHundred.L20, sheetRow.teamProfile?.scored.L20.games)}</span>
                  <span className="pill">opp allowed 100+ L20 {rateCell(sheetRow.opponentProfile?.allowedHundred.L20, sheetRow.opponentProfile?.allowed.L20.games)}</span>
                  <span className="expand-hint">All inputs ▾</span>
                </div>
              </summary>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Input ({sheetRow.profileSeason})</th>
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
                        <td key={windowName}>{windowCell(sheetRow.teamProfile?.scored[windowName])}</td>
                      ))}
                      <td>{windowCell(sheetRow.teamProfile?.scored.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} Q1-Q3 allowed</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(sheetRow.opponentProfile?.allowed[windowName])}</td>
                      ))}
                      <td>{windowCell(sheetRow.opponentProfile?.allowed.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{teamName.abbreviation} pace</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(sheetRow.teamProfile?.pace[windowName])}</td>
                      ))}
                      <td>{windowCell(sheetRow.teamProfile?.pace.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} pace</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{windowCell(sheetRow.opponentProfile?.pace[windowName])}</td>
                      ))}
                      <td>{windowCell(sheetRow.opponentProfile?.pace.SEASON)}</td>
                    </tr>
                    <tr>
                      <td>{teamName.abbreviation} scored 100+ thru 3</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{rateCell(sheetRow.teamProfile?.scoredHundred[windowName], sheetRow.teamProfile?.scored[windowName].games)}</td>
                      ))}
                      <td>{rateCell(sheetRow.teamProfile?.scoredHundred.SEASON, sheetRow.teamProfile?.scored.SEASON.games)}</td>
                    </tr>
                    <tr>
                      <td>{opponentName.abbreviation} allowed 100+ thru 3</td>
                      {windows.map((windowName) => (
                        <td key={windowName}>{rateCell(sheetRow.opponentProfile?.allowedHundred[windowName], sheetRow.opponentProfile?.allowed[windowName].games)}</td>
                      ))}
                      <td>{rateCell(sheetRow.opponentProfile?.allowedHundred.SEASON, sheetRow.opponentProfile?.allowed.SEASON.games)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="faint small" style={{ marginBottom: 0 }}>
                Line: {sheetRow.lineSource} consensus · share from {sheetRow.share.source} ({sheetRow.share.games} games) · P(100+) = 1 − Φ((99.5 − {formatNumber(sheetRow.projection.projection)}) / {formatNumber(sheetRow.projection.standardDeviation)})
              </p>
            </details>
          );
        })}
      </div>
    </main>
  );
}
