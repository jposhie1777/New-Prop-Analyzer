"use client";

import { booksKey } from "@/lib/client/bookFilter";

import Link from "next/link";
import { PriceButton } from "@/components/PriceButton";
import { useAnalyticsQuery, useSettings, useVisiblePolling } from "@/lib/client/hooks";
import { loadProps } from "@/lib/client/slateData";
import { secondHalfProfiles } from "@/lib/analytics/aggregates/playerAggregates";
import { buildHalftimeSuggestions } from "@/lib/analytics/halftimeSuggestions";
import { buildPropPick } from "@/lib/client/pickBuilders";
import { propMapping } from "@/lib/analytics/propTypes";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
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
  const valueOnlySuggestions = suggestions.filter((suggestion) => suggestion.firstHalfActual <= suggestion.lineValue);
  const groups = new Map<number, typeof suggestions>();
  for (const suggestion of valueOnlySuggestions) groups.set(suggestion.playerId, [...(groups.get(suggestion.playerId) ?? []), suggestion]);
  const orderedGroups = [...groups.values()].sort((first, second) => Math.max(...second.map((suggestion) => (suggestion.flagged ? (suggestion.evaluation.bestEvPercent ?? 0) : -999))) - Math.max(...first.map((suggestion) => (suggestion.flagged ? (suggestion.evaluation.bestEvPercent ?? 0) : -999))));
  return (
    <div>
      <div className="row-between wrap" style={{ marginBottom: 8 }}>
        <span className="small muted">
          {flagged.length} value pick{flagged.length === 1 ? "" : "s"} at ≥{settings.evThresholdPercent}% · tap a price to add it
        </span>
      </div>
      {props.loading && !props.data ? <div className="skeleton" /> : null}
      {props.data && orderedGroups.length === 0 ? <div className="empty-state">No live props for this game right now.</div> : null}
      <div className="card-grid">
        {orderedGroups.map((group) => {
          const hasValue = group.some((suggestion) => suggestion.flagged);
          return (
            <div key={group[0].playerId} className={`player-group${hasValue ? " has-value" : ""}`}>
              <div className="player-group-header">
                <Link href={`/player/${group[0].playerId}`} className="strong">
                  {group[0].playerName}
                </Link>
                <span className="faint small">
                  {formatNumber(group[0].firstHalfMinutes, 0)} min · {group[0].personalFouls} PF
                </span>
              </div>
              {group.map((suggestion) => {
                const fairOver = suggestion.evaluation.noVigOver;
                const trusted = fairOver !== null && Math.abs(suggestion.evaluation.overProbability - fairOver) <= 0.2; // EV only when the model is near the market
                const overNote = trusted && suggestion.evaluation.overEvPercent !== null ? `${formatSigned(suggestion.evaluation.overEvPercent, 0)}% EV` : null;
                const underNote = trusted && suggestion.evaluation.underEvPercent !== null ? `${formatSigned(suggestion.evaluation.underEvPercent, 0)}% EV` : null;
                return (
                  <div key={suggestion.propType} className="prop-line">
                    <div style={{ minWidth: 0 }}>
                      <div className="prop-line-title">
                        <span className="strong">{propMapping(suggestion.propType)?.label ?? suggestion.propType}</span>
                        <span className="tabular">
                          <span className="strong">{suggestion.firstHalfActual}</span>
                          <span className="faint"> / {suggestion.lineValue}</span>
                        </span>
                      </div>
                      <div className="faint small" style={{ marginTop: 4 }}>
                        proj {formatNumber(suggestion.projection.projection)} · 2H avg {formatNumber(suggestion.secondHalfAverage)}
                        {suggestion.projection.minutesFactor < 1 ? ` · min ×${formatNumber(suggestion.projection.minutesFactor, 2)}` : ""}
                        {trusted ? ` · over ${formatPercent(suggestion.evaluation.overProbability, 0)} vs ${formatPercent(fairOver, 0)} fair` : " · model far from market"}
                      </div>
                    </div>
                    <div className="price-pair">
                      <PriceButton pick={buildPropPick(game, suggestion.playerId, suggestion.playerName, suggestion.propType, "over", props.data ?? [], gameOdds, "halftime", suggestion.evaluation.overProbability, suggestion.lineValue)} sideLabel={`O ${suggestion.lineValue}`} odds={suggestion.bestOverOdds} vendor={suggestion.bestOverVendor} note={overNote} highlight={trusted && (suggestion.evaluation.overEvPercent ?? -1) >= settings.evThresholdPercent} />
                      <PriceButton pick={buildPropPick(game, suggestion.playerId, suggestion.playerName, suggestion.propType, "under", props.data ?? [], gameOdds, "halftime", suggestion.evaluation.underProbability, suggestion.lineValue)} sideLabel={`U ${suggestion.lineValue}`} odds={suggestion.bestUnderOdds} vendor={suggestion.bestUnderVendor} note={underNote} highlight={trusted && (suggestion.evaluation.underEvPercent ?? -1) >= settings.evThresholdPercent} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="expand-hint">How halftime picks work</summary>
        <p className="faint small">
          Projection = 1st-half actual + the player&apos;s 2nd-half average over his last 10 games, with minutes trimmed for foul trouble and {appSettings.blowoutMargin}+ point margins. EV compares the model with the best live price and shows only when the model is within 20 points of the de-vigged market. Informational, not guaranteed.
        </p>
      </details>
    </div>
  );
}
