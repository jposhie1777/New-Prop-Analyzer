"use client";

import Link from "next/link";
import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { PriceButton } from "@/components/PriceButton";
import { useSettings } from "@/lib/client/hooks";
import type { LivePropData } from "@/lib/client/liveProps";
import { maximumModelMarketGap, type LivePropRow } from "@/lib/analytics/liveSuggestions";
import { buildMilestonePick, buildPropPick } from "@/lib/client/pickBuilders";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";

interface PlayerGroup {
  playerId: number;
  playerName: string;
  teamAbbreviation: string;
  minutesPlayed: number;
  personalFouls: number;
  rows: LivePropRow[];
  bestValue: number;
}

function isTrusted(propRow: LivePropRow): boolean {
  return propRow.currentValue <= propRow.lineValue && propRow.prior.source === "pregame line" && propRow.modelMarketGap !== null && propRow.modelMarketGap <= maximumModelMarketGap; // EV is only meaningful when the model is near the market
}

function evNote(evPercent: number | null, trusted: boolean, threshold: number): { note: string | null; highlight: boolean } {
  if (!trusted || evPercent === null) return { note: null, highlight: false };
  return { note: `${formatSigned(evPercent, 0)}% EV`, highlight: evPercent >= threshold };
}

export function PropLine({ propRow, game, props, gameOdds, threshold }: { propRow: LivePropRow; game: BdlGame; props: BdlPlayerProp[]; gameOdds: BdlBettingOdd[]; threshold: number }) {
  const trusted = isTrusted(propRow);
  const cashed = propRow.currentValue > propRow.lineValue;
  const overNote = evNote(propRow.evaluation.overEvPercent, trusted, threshold);
  const underNote = evNote(propRow.evaluation.underEvPercent, trusted, threshold);
  const progress = Math.min(1, propRow.lineValue > 0 ? propRow.currentValue / propRow.lineValue : 0);
  const fairOver = propRow.evaluation.noVigOver;
  const extraLines = propRow.ladder.filter((rung) => rung.line !== propRow.lineValue);
  return (
    <div className="prop-line">
      <div style={{ minWidth: 0 }}>
        <div className="prop-line-title">
          <span className="strong">{propRow.label}</span>
          <span className="tabular">
            <span className="strong">{propRow.currentValue}</span>
            <span className="faint"> / {propRow.lineValue}</span>
          </span>
          {cashed ? <span className="pill positive">cashed</span> : null}
        </div>
        <div className="prop-progress">
          <span style={{ width: `${Math.round(progress * 100)}%`, background: cashed ? "var(--positive)" : undefined }} />
        </div>
        <div className="faint small" style={{ marginTop: 4 }}>
          proj {formatNumber(propRow.projection.projection)}
          {propRow.restOfGame ? ` · ${propRow.restOfGame.label} avg ${formatNumber(propRow.restOfGame.value)} (L${propRow.sampleGames})` : ""}
          {cashed ? "" : trusted ? ` · over ${formatPercent(propRow.evaluation.overProbability, 0)} vs ${formatPercent(fairOver, 0)} fair` : propRow.prior.source !== "pregame line" ? " · no pregame line" : " · model far from market"}
        </div>
      </div>
      {cashed ? (
        <span className="faint small">line is stale</span>
      ) : (
        <div className="price-pair">
          <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "over", props, gameOdds, "live", propRow.evaluation.overProbability, propRow.lineValue)} sideLabel={`O ${propRow.lineValue}`} odds={propRow.bestOverOdds} vendor={propRow.bestOverVendor} note={overNote.note} highlight={overNote.highlight} />
          <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "under", props, gameOdds, "live", propRow.evaluation.underProbability, propRow.lineValue)} sideLabel={`U ${propRow.lineValue}`} odds={propRow.bestUnderOdds} vendor={propRow.bestUnderVendor} note={underNote.note} highlight={underNote.highlight} />
        </div>
      )}
      {!cashed && (extraLines.length > 0 || propRow.milestones.length > 0) ? (
        <details className="more-lines">
          <summary>
            More lines ({extraLines.length + propRow.milestones.length}) ▾
          </summary>
          {extraLines.map((rung) => (
            <div key={rung.line} className="ladder-row">
              <span className="tabular strong">{rung.line}</span>
              <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "over", props, gameOdds, "live", rung.overProbability, rung.line)} sideLabel={`O ${rung.line}`} odds={rung.overOdds} vendor={rung.overVendor} note={trusted ? `${formatPercent(rung.overProbability, 0)} model` : null} />
              <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "under", props, gameOdds, "live", rung.underProbability, rung.line)} sideLabel={`U ${rung.line}`} odds={rung.underOdds} vendor={rung.underVendor} note={trusted ? `${formatPercent(rung.underProbability, 0)} model` : null} />
            </div>
          ))}
          {propRow.milestones.length > 0 ? (
            <div className="milestone-grid">
              {propRow.milestones.map((milestone) => (
                <PriceButton
                  key={milestone.threshold}
                  pick={buildMilestonePick(game, propRow.playerId, propRow.playerName, propRow.propType, milestone.threshold, props, gameOdds, "live", milestone.probability)}
                  sideLabel={`${milestone.threshold}+`}
                  odds={milestone.odds}
                  vendor={milestone.vendor}
                  note={trusted ? `${formatPercent(milestone.probability, 0)} model` : null}
                />
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export function LivePropsPanel({ game, data, gameOdds }: { game: BdlGame; data: LivePropData; gameOdds: BdlBettingOdd[] }) {
  const settings = useSettings();
  const [marketFilter, setMarketFilter] = useState("all");
  const [valueOnly, setValueOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { rows, props: propList } = data;
  const flaggedRows = data.valuePicks;
  const clockText = data.clock ? (data.clock.isHalftime ? "halftime" : `Q${Math.min(data.clock.period, 4)}`) : "";
  const markets = [...new Set(rows.map((propRow) => propRow.label))];
  const normalizedSearch = searchText.trim().toLowerCase();
  const visibleRows = rows
    .filter((propRow) => marketFilter === "all" || propRow.label === marketFilter)
    .filter((propRow) => !valueOnly || propRow.flagged)
    .filter((propRow) => !normalizedSearch || propRow.playerName.toLowerCase().includes(normalizedSearch));
  const groups = new Map<number, PlayerGroup>();
  for (const propRow of visibleRows) {
    const group = groups.get(propRow.playerId) ?? { playerId: propRow.playerId, playerName: propRow.playerName, teamAbbreviation: propRow.teamAbbreviation, minutesPlayed: propRow.minutesPlayed, personalFouls: propRow.personalFouls, rows: [], bestValue: -Infinity };
    group.rows.push(propRow);
    if (propRow.flagged) group.bestValue = Math.max(group.bestValue, propRow.evaluation.bestEvPercent ?? -Infinity);
    groups.set(propRow.playerId, group);
  }
  const orderedGroups = [...groups.values()].sort((first, second) => second.minutesPlayed - first.minutesPlayed); // most minutes tonight first

  return (
    <div id="live-props" style={{ scrollMarginTop: 70 }}>
      <div className="row-between wrap" style={{ marginBottom: 8 }}>
        <span className="small muted">
          {orderedGroups.length} players · {flaggedRows.length} value pick{flaggedRows.length === 1 ? "" : "s"} · tap a player to see props
        </span>
        <button className={`toggle-button${valueOnly ? " open" : ""}`} onClick={() => setValueOnly((previous) => !previous)}>
          {valueOnly ? "✓ Value only" : "Value only"}
        </button>
      </div>
      <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
        {markets.length > 1 ? <Segmented options={[{ value: "all", label: "All" }, ...markets.map((market) => ({ value: market, label: market }))]} value={marketFilter} onChange={setMarketFilter} label="Market" /> : null}
        {rows.length > 12 ? <input className="input" placeholder="Find a player…" value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} /> : null}
      </div>
      {data.error ? <div className="notice">Live props unavailable: {data.error}</div> : null}
      {data.loading ? <div className="skeleton" /> : null}
      {!data.loading && rows.length === 0 ? <div className="empty-state">No live player props posted right now. Books often pull them during play.</div> : null}
      {rows.length > 0 && orderedGroups.length === 0 ? <div className="empty-state">Nothing matches these filters.</div> : null}
      <div className="card-grid">
        {orderedGroups.map((group) => (
          <details key={group.playerId} className={`player-group${group.bestValue > -Infinity ? " has-value" : ""}`} open={normalizedSearch !== "" || undefined}>
            <summary className="player-group-header">
              <span className="player-group-name">
                <span className="strong">{group.playerName}</span> <span className="faint small">{group.teamAbbreviation}</span>
                <span className="player-group-stats faint">
                  {formatNumber(group.minutesPlayed, 0)} min · {group.personalFouls} PF · {group.rows.length} prop{group.rows.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="player-group-meta small">
                {group.bestValue > -Infinity ? <span className="pill positive">{formatSigned(group.bestValue, 0)}% EV</span> : null}
                <span className="player-group-chevron">▾</span>
              </span>
            </summary>
            {group.rows.map((propRow) => (
              <PropLine key={propRow.propType} propRow={propRow} game={game} props={propList} gameOdds={gameOdds} threshold={settings.evThresholdPercent} />
            ))}
            <Link href={`/player/${group.playerId}`} className="expand-hint" style={{ display: "inline-block", marginTop: 8 }}>
              Player page →
            </Link>
          </details>
        ))}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="expand-hint">How projections work</summary>
        <p className="faint small">
          Projection = current stat + the pregame line for the time left (now at {clockText}), split by the player&apos;s usual quarters, nudged by tonight&apos;s pace (more late in games), trimmed for foul trouble and second-half blowouts. EV shows only when the model is within {Math.round(maximumModelMarketGap * 100)} points of the de-vigged market; bigger gaps usually mean missing news. Green = at or above your {settings.evThresholdPercent}% threshold. Informational, not guaranteed.
        </p>
      </details>
    </div>
  );
}
