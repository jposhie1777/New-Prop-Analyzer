"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddToSlipButton } from "@/components/AddToSlipButton";
import { Segmented } from "@/components/Segmented";
import { useAnalyticsQuery, useSettings, useVisiblePolling } from "@/lib/client/hooks";
import { loadProps } from "@/lib/client/slateData";
import { quarterProfiles } from "@/lib/analytics/aggregates/playerAggregates";
import { buildLivePropRows, type LivePropRow } from "@/lib/analytics/liveSuggestions";
import { clockLabel } from "@/lib/analytics/liveProjection";
import { buildPropPick } from "@/lib/client/pickBuilders";
import { formatAmerican } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { vendorLabel } from "@/lib/odds/deeplinks";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { livePropToTracked } from "@/lib/tracking/fromSources";
import type { BdlBettingOdd, BdlBoxScore, BdlGame } from "@/lib/bdl/types";

type SortMode = "ev" | "player" | "needed";

function sideOf(propRow: LivePropRow): "over" | "under" {
  return propRow.evaluation.bestSide ?? "over";
}

export function LivePropsPanel({ game, boxScore, gameOdds }: { game: BdlGame; boxScore: BdlBoxScore; gameOdds: BdlBettingOdd[] }) {
  const settings = useSettings();
  const [marketFilter, setMarketFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("ev");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [searchText, setSearchText] = useState("");
  const props = useVisiblePolling(() => loadProps(game.id), 60_000, `live-props:${game.id}`); // live lines refresh every 60s while visible
  const playerIds = [...boxScore.home_team.players, ...boxScore.visitor_team.players].map((boxPlayer) => boxPlayer.player.id);
  const profiles = useAnalyticsQuery(playerIds.length > 0 ? (handle) => quarterProfiles(handle.engine, playerIds, 10) : null, `quarters:${game.id}:${playerIds.length}`);
  const { rows, clock } = buildLivePropRows(boxScore, props.data ?? [], profiles.result ?? new Map(), settings.evThresholdPercent);
  const clockText = clockLabel(boxScore.status, boxScore.time);
  const flaggedRows = rows.filter((propRow) => propRow.flagged);
  const flaggedKey = flaggedRows.map((propRow) => `${propRow.playerId}:${propRow.propType}`).join(",");
  useEffect(() => {
    if (flaggedRows.length > 0 && profiles.result) trackPicks(flaggedRows.map((propRow) => livePropToTracked(propRow, game.id, game.date, clockText))); // graded later on the Record page
  }, [flaggedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const markets = [...new Set(rows.map((propRow) => propRow.label))];
  const normalizedSearch = searchText.trim().toLowerCase();
  const visibleRows = rows
    .filter((propRow) => marketFilter === "all" || propRow.label === marketFilter)
    .filter((propRow) => !onlyFlagged || propRow.flagged)
    .filter((propRow) => !normalizedSearch || propRow.playerName.toLowerCase().includes(normalizedSearch))
    .sort((first, second) => {
      const cashedOrder = Number(first.currentValue > first.lineValue) - Number(second.currentValue > second.lineValue);
      if (cashedOrder !== 0) return cashedOrder; // already-cashed (stale) lines go last
      if (sortMode === "player") return first.playerName.localeCompare(second.playerName) || first.label.localeCompare(second.label);
      if (sortMode === "needed") return first.needed - second.needed;
      return (second.evaluation.bestEvPercent ?? -999) - (first.evaluation.bestEvPercent ?? -999);
    });

  return (
    <section id="live-props" className="card" style={{ marginTop: 0, scrollMarginTop: 70 }}>
      <div className="card-header wrap">
        <div>
          <h2>
            Live props · {game.visitor_team.abbreviation} @ {game.home_team.abbreviation} <span className="pill live" style={{ marginLeft: 6 }}><span className="live-dot" />{clockText}</span>
          </h2>
          <div className="faint small">
            Projection = current stat + the player&apos;s last-10 per-quarter averages for the time left ({formatPercent(rows[0]?.projection.remainingShare ?? (clock.isFinished ? 0 : null), 0)} of the game), trimmed for foul trouble and second-half blowouts. Lines refresh every 60s.
          </div>
        </div>
        <span className="pill warning">
          {flaggedRows.length} at ≥{settings.evThresholdPercent}% EV
        </span>
      </div>
      <p className="disclaimer">Informational, not guaranteed. Live lines move fast; check the book before betting.</p>
      <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
        <input className="input" placeholder="Filter by player…" value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} />
        <div className="row wrap">
          <Segmented options={[{ value: "all", label: "All" }, ...markets.map((market) => ({ value: market, label: market }))]} value={marketFilter} onChange={setMarketFilter} label="Market" />
        </div>
        <div className="row wrap">
          <Segmented
            options={[
              { value: "ev", label: "Best EV" },
              { value: "needed", label: "Closest to hitting" },
              { value: "player", label: "Player" },
            ]}
            value={sortMode}
            onChange={setSortMode}
            label="Sort"
          />
          <button className={`button small${onlyFlagged ? " added" : " ghost"}`} onClick={() => setOnlyFlagged((previous) => !previous)}>
            {onlyFlagged ? "✓ Flagged only" : "Flagged only"}
          </button>
        </div>
      </div>
      {props.error ? <div className="notice">Live props unavailable: {props.error}</div> : null}
      {props.loading && !props.data ? <div className="skeleton" /> : null}
      {props.data && rows.length === 0 ? <div className="empty-state">No live player props posted for this game right now. Books often pull them during play and late in games.</div> : null}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {visibleRows.map((propRow) => {
          const side = sideOf(propRow);
          const sideOdds = side === "over" ? propRow.bestOverOdds : propRow.bestUnderOdds;
          const sideVendor = side === "over" ? propRow.bestOverVendor : propRow.bestUnderVendor;
          const modelChance = side === "over" ? propRow.evaluation.overProbability : propRow.evaluation.underProbability;
          const fairChance = side === "over" ? propRow.evaluation.noVigOver : propRow.evaluation.noVigUnder;
          const alreadyOver = propRow.currentValue > propRow.lineValue;
          const evClass = (propRow.evaluation.bestEvPercent ?? 0) >= settings.evThresholdPercent ? "positive" : (propRow.evaluation.bestEvPercent ?? 0) < 0 ? "negative" : "";
          return (
            <div key={`${propRow.playerId}-${propRow.propType}`} className={`prop-card${propRow.flagged ? " flag-ev" : ""}`}>
              <div className="row-between">
                <span style={{ minWidth: 0 }}>
                  <Link href={`/player/${propRow.playerId}`} className="strong">
                    {propRow.playerName}
                  </Link>{" "}
                  <span className="faint small">{propRow.teamAbbreviation}</span>
                </span>
                {alreadyOver ? <span className="pill">stale line</span> : <span className={`pill ${evClass}`}>EV {propRow.evaluation.bestEvPercent === null ? "-" : `${formatSigned(propRow.evaluation.bestEvPercent)}%`}</span>}
              </div>
              <div className="row-between">
                <span>
                  <span className="strong">{propRow.label}</span> <span className="pill accent tabular">{propRow.lineValue}</span>
                </span>
                <span className="tabular strong" style={{ fontSize: 18 }}>
                  {propRow.currentValue} <span className="faint small">{alreadyOver ? "cashed" : `need ${propRow.needed}`}</span>
                </span>
              </div>
              <div className="row-between small">
                <span className="muted">
                  Proj <span className="strong">{formatNumber(propRow.projection.projection)}</span> ±{formatNumber(propRow.projection.standardDeviation)}
                </span>
                <span className="muted">
                  {side === "over" ? "Over" : "Under"} {formatPercent(modelChance, 0)} <span className="faint">vs fair {formatPercent(fairChance, 0)}</span>
                </span>
              </div>
              <div className="faint small">
                {formatNumber(propRow.minutesPlayed, 0)} min · {propRow.personalFouls} PF{propRow.projection.adjustments.length > 0 ? ` · ${propRow.projection.adjustments.join(", ")}` : ""}
              </div>
              <div className="row-between">
                <span className="small">
                  Best {side}: <span className="strong">{formatAmerican(sideOdds)}</span> <span className="faint">{sideVendor ? vendorLabel(sideVendor) : ""}</span>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <AddToSlipButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "over", props.data ?? [], gameOdds, "live", propRow.evaluation.overProbability)} label="+ O" />
                  <AddToSlipButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "under", props.data ?? [], gameOdds, "live", propRow.evaluation.underProbability)} label="+ U" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {profiles.result && rows.some((propRow) => propRow.sampleGames === 0) ? <p className="faint small">Players with no logged games (rookies, new signings) project from their current line only and are never flagged.</p> : null}
    </section>
  );
}
