"use client";

import { booksKey } from "@/lib/client/bookFilter";

import Link from "next/link";
import { AddToSlipButton } from "@/components/AddToSlipButton";
import { useAnalyticsQuery, useSettings, useVisiblePolling } from "@/lib/client/hooks";
import { loadProps } from "@/lib/client/slateData";
import { secondHalfProfiles } from "@/lib/analytics/aggregates/playerAggregates";
import { buildHalftimeSuggestions } from "@/lib/analytics/halftimeSuggestions";
import { buildPropPick } from "@/lib/client/pickBuilders";
import { propMapping } from "@/lib/analytics/propTypes";
import { formatAmerican } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { vendorLabel } from "@/lib/odds/deeplinks";
import { appSettings } from "@/config/appSettings";
import type { BdlBettingOdd, BdlBoxScore, BdlGame } from "@/lib/bdl/types";
import { useEffect } from "react";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { halftimeToTracked } from "@/lib/tracking/fromSources";

export function HalftimePanel({ game, boxScore, gameOdds }: { game: BdlGame; boxScore: BdlBoxScore; gameOdds: BdlBettingOdd[] }) {
  const settings = useSettings();
  const props = useVisiblePolling(() => loadProps(game.id, false, settings.enabledBooks), 60_000, `halftime-props:${game.id}:${booksKey(settings.enabledBooks)}`); // live lines, 60s like the CDN cache
  const playerIds = [...boxScore.home_team.players, ...boxScore.visitor_team.players].map((boxPlayer) => boxPlayer.player.id);
  const profiles = useAnalyticsQuery(playerIds.length > 0 ? (handle) => secondHalfProfiles(handle.engine, playerIds, 10) : null, `h2:${game.id}:${playerIds.length}`);
  const suggestions = profiles.result ? buildHalftimeSuggestions(boxScore, props.data ?? [], profiles.result, settings.evThresholdPercent) : [];
  const flagged = suggestions.filter((suggestion) => suggestion.flagged);
  const flaggedKey = flagged.map((suggestion) => `${suggestion.playerId}:${suggestion.propType}`).join(",");
  useEffect(() => {
    if (flagged.length > 0) trackPicks(flagged.map((suggestion) => halftimeToTracked(suggestion, game.id, game.date))); // flagged picks are graded later on the Record page
  }, [flaggedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card" style={{ borderColor: "rgba(251, 191, 36, 0.35)" }}>
      <div className="card-header wrap">
        <div>
          <h2>Halftime mode · {game.visitor_team.abbreviation} @ {game.home_team.abbreviation}</h2>
          <div className="faint small">
            Projection = 1st-half actual + 2nd-half average (last 10 games), minutes trimmed for foul trouble and {appSettings.blowoutMargin}+ point margins. EV compares the model to the best live price; the no-vig market price is shown for reference.
          </div>
        </div>
        <span className="pill warning">
          {flagged.length} at ≥{settings.evThresholdPercent}% EV
        </span>
      </div>
      <p className="disclaimer">Informational, not guaranteed. Models miss injuries, rotations and garbage time. Bet responsibly.</p>
      {props.loading && !props.data ? <div className="skeleton" /> : null}
      {props.data && suggestions.length === 0 ? <div className="empty-state">No live props for this game right now.</div> : null}
      <div className="card-grid">
        {suggestions.slice(0, 24).map((suggestion) => {
          const side = suggestion.evaluation.bestSide ?? "over";
          const sideOdds = side === "over" ? suggestion.bestOverOdds : suggestion.bestUnderOdds;
          const sideVendor = side === "over" ? suggestion.bestOverVendor : suggestion.bestUnderVendor;
          const modelChance = side === "over" ? suggestion.evaluation.overProbability : suggestion.evaluation.underProbability;
          const fairChance = side === "over" ? suggestion.evaluation.noVigOver : suggestion.evaluation.noVigUnder;
          return (
            <div key={`${suggestion.playerId}-${suggestion.propType}`} className={`prop-card${suggestion.flagged ? " flag-ev" : ""}`}>
              <div className="row-between">
                <Link href={`/player/${suggestion.playerId}`} className="strong">
                  {suggestion.playerName}
                </Link>
                <span className={`pill ${suggestion.flagged ? "positive" : ""}`}>EV {formatSigned(suggestion.evaluation.bestEvPercent)}%</span>
              </div>
              <div className="row-between">
                <span>
                  <span className="strong">{side === "over" ? "Over" : "Under"}</span> {suggestion.lineValue} {propMapping(suggestion.propType)?.label}
                </span>
                <span className="tabular">
                  {formatAmerican(sideOdds)} <span className="faint small">{sideVendor ? vendorLabel(sideVendor) : ""}</span>
                </span>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>1st half actual</td>
                      <td>
                        {formatNumber(suggestion.firstHalfActual, 0)} <span className="sub">{formatNumber(suggestion.firstHalfMinutes)} min</span>
                      </td>
                    </tr>
                    <tr>
                      <td>2nd half avg L{suggestion.sampleGames}</td>
                      <td>
                        {formatNumber(suggestion.secondHalfAverage)} <span className="sub">{formatNumber(suggestion.secondHalfMinutesAverage)} min</span>
                      </td>
                    </tr>
                    <tr>
                      <td>Minutes factor</td>
                      <td title={suggestion.projection.adjustments.join("; ")}>
                        ×{formatNumber(suggestion.projection.minutesFactor, 2)} <span className="sub">{suggestion.personalFouls} PF · margin {suggestion.margin}</span>
                      </td>
                    </tr>
                    <tr>
                      <td>Projection</td>
                      <td className="strong">
                        {formatNumber(suggestion.projection.projection)} <span className="sub">σ {formatNumber(suggestion.projection.standardDeviation)}</span>
                      </td>
                    </tr>
                    <tr>
                      <td>Model vs no-vig</td>
                      <td>
                        {formatPercent(modelChance, 1)} <span className="sub">vs {formatPercent(fairChance, 1)}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {suggestion.projection.adjustments.length > 0 ? <div className="faint small">{suggestion.projection.adjustments.join(" · ")}</div> : null}
              <AddToSlipButton pick={buildPropPick(game, suggestion.playerId, suggestion.playerName, suggestion.propType, side, props.data ?? [], gameOdds, "halftime", modelChance)} label={`+ ${side === "over" ? "Over" : "Under"} to slip`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
