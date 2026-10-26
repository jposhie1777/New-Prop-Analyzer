"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { PriceButton } from "@/components/PriceButton";
import { useSettings } from "@/lib/client/hooks";
import type { LivePropData } from "@/lib/client/liveProps";
import { maximumModelMarketGap, type LivePropRow } from "@/lib/analytics/liveSuggestions";
import { buildMilestonePick, buildPropPick } from "@/lib/client/pickBuilders";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { formatAmerican } from "@/lib/math/odds";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";

const columnSets = {
  core: [
    { propType: "points", header: "Pts" },
    { propType: "rebounds", header: "Reb" },
    { propType: "assists", header: "Ast" },
    { propType: "threes", header: "3PM" },
  ],
  combos: [
    { propType: "points_rebounds_assists", header: "PRA" },
    { propType: "points_rebounds", header: "P+R" },
    { propType: "points_assists", header: "P+A" },
    { propType: "rebounds_assists", header: "R+A" },
  ],
};

type ColumnSetName = keyof typeof columnSets;

export const shootingProps = new Set(["points", "threes", "points_rebounds_assists", "points_rebounds", "points_assists"]); // props where shooting luck matters

interface PlayerLine {
  playerId: number;
  playerName: string;
  shortName: string;
  teamAbbreviation: string;
  minutesPlayed: number;
  personalFouls: number;
  inactiveNote: string | null;
  propsByType: Map<string, LivePropRow>;
  hasValue: boolean;
}

interface LineStop {
  key: string;
  label: string;
  line: number;
  kind: "line" | "milestone";
  overOdds: number | null;
  overVendor: string | null;
  underOdds: number | null;
  underVendor: string | null;
  overProbability: number;
  underProbability: number;
  overEvPercent: number | null;
  underEvPercent: number | null;
  books: number;
  isMain: boolean;
}

function isTrusted(propRow: LivePropRow): boolean {
  return !propRow.inactiveNote && propRow.currentValue <= propRow.lineValue && propRow.prior.source === "pregame line" && propRow.modelMarketGap !== null && propRow.modelMarketGap <= maximumModelMarketGap; // EV is only meaningful when the model is near the market
}

export function shootingTag(shooting: LivePropRow["shooting"]): string | null {
  if (!shooting || Math.abs(shooting.luck) < 3) return null;
  return shooting.luck < 0 ? "cold shooting" : "hot shooting"; // cold shooters tend to bounce back, hot ones to cool off
}

function shortPlayerName(fullName: string): string {
  const [firstName, ...rest] = fullName.split(" ");
  return rest.length > 0 ? `${firstName.charAt(0)}. ${rest.join(" ")}` : fullName;
}

export function lineStops(propRow: LivePropRow): LineStop[] {
  const ladderStops: LineStop[] = propRow.ladder.map((rung) => ({
    key: `line-${rung.line}`,
    label: String(rung.line),
    line: rung.line,
    kind: "line",
    overOdds: rung.overOdds,
    overVendor: rung.overVendor,
    underOdds: rung.underOdds,
    underVendor: rung.underVendor,
    overProbability: rung.overProbability,
    underProbability: rung.underProbability,
    overEvPercent: rung.overEvPercent,
    underEvPercent: rung.underEvPercent,
    books: rung.books,
    isMain: rung.line === propRow.lineValue,
  }));
  const ladderLines = new Set(ladderStops.map((stop) => stop.line));
  const milestoneStops: LineStop[] = propRow.milestones
    .filter((milestone) => !ladderLines.has(milestone.threshold - 0.5)) // "25+" is the same bet as over 24.5
    .map((milestone) => ({
      key: `milestone-${milestone.threshold}`,
      label: `${milestone.threshold}+`,
      line: milestone.threshold - 0.5,
      kind: "milestone",
      overOdds: milestone.odds,
      overVendor: milestone.vendor,
      underOdds: null,
      underVendor: null,
      overProbability: milestone.probability,
      underProbability: 1 - milestone.probability,
      overEvPercent: milestone.evPercent,
      underEvPercent: null,
      books: milestone.books,
      isMain: false,
    }));
  return [...ladderStops, ...milestoneStops].sort((first, second) => first.line - second.line);
}

function PropSheet({ propRow, game, props, gameOdds, threshold, onClose }: { propRow: LivePropRow; game: BdlGame; props: BdlPlayerProp[]; gameOdds: BdlBettingOdd[]; threshold: number; onClose: () => void }) {
  const stops = lineStops(propRow);
  const mainIndex = Math.max(0, stops.findIndex((stop) => stop.isMain));
  const [selectedIndex, setSelectedIndex] = useState(mainIndex);
  useEffect(() => setSelectedIndex(mainIndex), [propRow.playerId, propRow.propType]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = stops[Math.min(selectedIndex, stops.length - 1)];
  const trusted = isTrusted(propRow);
  const cashed = stop ? propRow.currentValue > stop.line : false;
  const evNote = (evPercent: number | null) => (trusted && evPercent !== null ? `${formatSigned(evPercent, 0)}% EV` : null);
  const overPick = !stop ? null : stop.kind === "milestone" ? buildMilestonePick(game, propRow.playerId, propRow.playerName, propRow.propType, stop.line + 0.5, props, gameOdds, "live", stop.overProbability) : buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "over", props, gameOdds, "live", stop.overProbability, stop.line);
  const underPick = !stop || stop.kind === "milestone" ? null : buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "under", props, gameOdds, "live", stop.underProbability, stop.line);
  const tag = shootingTag(propRow.shooting);
  return (
    <div className="prop-sheet-backdrop" onClick={onClose}>
      <section className="prop-sheet" role="dialog" aria-label={`${propRow.playerName} ${propRow.label}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <span className="prop-sheet-handle" aria-hidden="true" />
        <div className="row-between" style={{ alignItems: "baseline" }}>
          <span className="prop-sheet-title">
            {propRow.playerName} · {propRow.label}
          </span>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="small muted">
          {propRow.currentValue} now · proj {formatNumber(propRow.projection.projection)}
          {tag && shootingProps.has(propRow.propType) ? ` · ${tag}` : ""}
        </div>
        {propRow.inactiveNote ? <div className="warning-text small">⚠ {propRow.inactiveNote}</div> : null}
        {stop ? (
          <>
            <div className="line-picker">
              <div className="row-between" style={{ alignItems: "baseline" }}>
                <span className="section-label">Line</span>
                <span className="line-picker-value">
                  {stop.label} <span className="faint small">{stop.isMain ? "main" : stop.kind === "milestone" ? "milestone" : "alt"}</span>
                </span>
              </div>
              {stops.length > 1 ? (
                <label>
                  <span className="visually-hidden">Choose a line</span>
                  <input className="line-slider" type="range" min={0} max={stops.length - 1} step={1} value={selectedIndex} onChange={(changeEvent) => setSelectedIndex(Number(changeEvent.target.value))} />
                </label>
              ) : null}
              <div className="line-ticks">
                {stops.map((tickStop, tickIndex) => (
                  <button key={tickStop.key} className={`line-tick${tickIndex === selectedIndex ? " selected" : ""}${tickStop.isMain ? " main" : ""}`} onClick={() => setSelectedIndex(tickIndex)}>
                    {tickStop.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-stats">
              <div>
                <span>Over hits</span>
                <strong>{cashed ? "cashed" : formatPercent(stop.overProbability, 0)}</strong>
              </div>
              <div>
                <span>{propRow.restOfGame ? `${propRow.restOfGame.label} avg` : "Rest avg"}</span>
                <strong>{propRow.restOfGame ? formatNumber(propRow.restOfGame.value) : "–"}</strong>
              </div>
              <div>
                <span>Books</span>
                <strong>{stop.books}</strong>
              </div>
            </div>
            <div className="sheet-prices">
              <PriceButton pick={overPick} sideLabel={stop.kind === "milestone" ? `${stop.label}` : `Over ${stop.label}`} odds={stop.overOdds} vendor={stop.overVendor} note={evNote(stop.overEvPercent)} highlight={trusted && (stop.overEvPercent ?? -Infinity) >= threshold} />
              <PriceButton pick={underPick} sideLabel={stop.kind === "milestone" ? "No under" : `Under ${stop.label}`} odds={stop.underOdds} vendor={stop.underVendor} note={evNote(stop.underEvPercent)} highlight={trusted && (stop.underEvPercent ?? -Infinity) >= threshold} />
            </div>
          </>
        ) : null}
        <div className="faint small">
          {propRow.shooting ? `${propRow.shooting.actualPoints} pts on shots worth ${formatNumber(propRow.shooting.expectedPoints)}` : ""}
          {propRow.foulTimes.length > 0 ? `${propRow.shooting ? " · " : ""}Fouls: ${propRow.foulTimes.join(", ")}` : ""}
          {!trusted && !propRow.inactiveNote && !cashed ? `${propRow.shooting || propRow.foulTimes.length > 0 ? " · " : ""}${propRow.prior.source !== "pregame line" ? "no pregame line, EV hidden" : "model far from market, EV hidden"}` : ""}
        </div>
        <Link href={`/player/${propRow.playerId}`} className="expand-hint">
          Player page →
        </Link>
      </section>
    </div>
  );
}

const rowMarketOrder = ["points", "rebounds", "assists", "threes", "points_rebounds_assists", "points_rebounds", "points_assists", "rebounds_assists"];
const chipLabels: Record<string, string> = { points: "PTS", rebounds: "REB", assists: "AST", threes: "3PM", points_rebounds_assists: "PRA", points_rebounds: "P+R", points_assists: "P+A", rebounds_assists: "R+A" };

function bestValueRow(playerLine: PlayerLine): LivePropRow | null {
  return [...playerLine.propsByType.values()].filter((propRow) => propRow.flagged).sort((first, second) => (second.evaluation.bestEvPercent ?? 0) - (first.evaluation.bestEvPercent ?? 0))[0] ?? null;
}

function PlayerRow({ playerLine, game, props, gameOdds, threshold, onOpenMarket }: { playerLine: PlayerLine; game: BdlGame; props: BdlPlayerProp[]; gameOdds: BdlBettingOdd[]; threshold: number; onOpenMarket: (propRow: LivePropRow) => void }) {
  const [open, setOpen] = useState(false);
  const anyRow = [...playerLine.propsByType.values()][0];
  const best = bestValueRow(playerLine);
  const bestSide = best?.evaluation.bestSide ?? "over";
  const [firstName, ...restOfName] = playerLine.playerName.split(" ");
  const markets = rowMarketOrder.map((propType) => playerLine.propsByType.get(propType)).filter((propRow): propRow is LivePropRow => Boolean(propRow));
  const tag = shootingTag(anyRow.shooting);
  return (
    <div className={`live-row${open ? " open" : ""}${playerLine.inactiveNote ? " inactive" : ""}`}>
      <button className="live-row-main" onClick={() => setOpen((previous) => !previous)} aria-expanded={open}>
        <PlayerHeadshot playerId={playerLine.playerId} firstName={firstName} lastName={restOfName.join(" ")} />
        <span className="live-row-name">
          {playerLine.playerName} <span className="faint small">{playerLine.teamAbbreviation}</span>
        </span>
        <span className="live-row-stats">
            {formatNumber(playerLine.minutesPlayed, 0)} min · {anyRow.boxLine.points} pts · {anyRow.boxLine.rebounds} reb · {anyRow.boxLine.assists} ast · {anyRow.boxLine.threesMade} 3pm
            {playerLine.personalFouls >= 3 ? <span className="negative"> · {playerLine.personalFouls} pf</span> : null}
        </span>
        {playerLine.inactiveNote ? (
          <span className="pill warning">May be out</span>
        ) : best ? (
          <span className="live-row-chip value">
            <span>
              {bestSide === "over" ? "O" : "U"} {best.lineValue} {chipLabels[best.propType] ?? best.label}
            </span>
            <strong>{formatAmerican(bestSide === "over" ? best.bestOverOdds : best.bestUnderOdds)}</strong>
          </span>
        ) : (
          <span className="live-row-chip">
            <span>{markets.length} props</span>
            <strong className="faint">no edge</strong>
          </span>
        )}
      </button>
      {open ? (
        <div className="live-row-panel">
          {playerLine.inactiveNote ? <div className="warning-text small">⚠ {playerLine.inactiveNote}. No picks for him until he&apos;s back.</div> : null}
          <div className="market-table" role="table" aria-label={`${playerLine.playerName} markets`}>
            <div className="market-table-row market-table-head" role="row">
              <span role="columnheader">Market</span>
              <span role="columnheader">Now</span>
              <span role="columnheader">Over</span>
              <span role="columnheader">Under</span>
            </div>
            {markets.map((propRow) => {
              const trusted = isTrusted(propRow);
              const cashed = propRow.currentValue > propRow.lineValue;
              const lineCount = lineStops(propRow).length;
              const evNote = (evPercent: number | null) => (trusted && evPercent !== null ? `${formatSigned(evPercent, 0)}% EV` : null);
              return (
                <div key={propRow.propType} className="market-table-row" role="row">
                  <button className="market-name" onClick={() => onOpenMarket(propRow)} role="cell">
                    <span>{propRow.label}</span>
                    <span className="market-name-lines">{lineCount > 1 ? `${lineCount} lines ›` : "details ›"}</span>
                  </button>
                  <span className={`market-now${cashed ? " positive" : ""}`} role="cell">
                    <strong>{propRow.currentValue}</strong>
                    <span className="faint">/{propRow.lineValue}</span>
                  </span>
                  <span role="cell">
                    <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "over", props, gameOdds, "live", propRow.evaluation.overProbability, propRow.lineValue)} sideLabel="" odds={cashed ? null : propRow.bestOverOdds} vendor={propRow.bestOverVendor} note={evNote(propRow.evaluation.overEvPercent)} highlight={trusted && (propRow.evaluation.overEvPercent ?? -Infinity) >= threshold} compact />
                  </span>
                  <span role="cell">
                    <PriceButton pick={buildPropPick(game, propRow.playerId, propRow.playerName, propRow.propType, "under", props, gameOdds, "live", propRow.evaluation.underProbability, propRow.lineValue)} sideLabel="" odds={cashed ? null : propRow.bestUnderOdds} vendor={propRow.bestUnderVendor} note={evNote(propRow.evaluation.underEvPercent)} highlight={trusted && (propRow.evaluation.underEvPercent ?? -Infinity) >= threshold} compact />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="faint small">
            {anyRow.shooting ? `${anyRow.shooting.actualPoints} pts on shots worth ${formatNumber(anyRow.shooting.expectedPoints)}${tag ? ` · ${tag}` : ""}` : ""}
            {anyRow.foulTimes.length > 0 ? `${anyRow.shooting ? " · " : ""}Fouls: ${anyRow.foulTimes.join(", ")}` : ""}
          </div>
          <div className="row-between small">
            <span className="faint">Tap a market for alt lines.</span>
            <Link href={`/player/${playerLine.playerId}`} className="expand-hint">
              Player page →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LivePropsPanel({ game, data, gameOdds }: { game: BdlGame; data: LivePropData; gameOdds: BdlBettingOdd[] }) {
  const settings = useSettings();
  const [columnSet, setColumnSet] = useState<ColumnSetName>("core");
  const [valueOnly, setValueOnly] = useState(false);
  const [openCell, setOpenCell] = useState<{ playerId: number; propType: string } | null>(null);
  const { rows, props: propList } = data;
  const columns = columnSets[columnSet];
  const rowsLayout = settings.liveLayout === "rows";
  const players = new Map<number, PlayerLine>();
  for (const propRow of rows) {
    const playerLine = players.get(propRow.playerId) ?? { playerId: propRow.playerId, playerName: propRow.playerName, shortName: shortPlayerName(propRow.playerName), teamAbbreviation: propRow.teamAbbreviation, minutesPlayed: propRow.minutesPlayed, personalFouls: propRow.personalFouls, inactiveNote: propRow.inactiveNote, propsByType: new Map(), hasValue: false };
    playerLine.propsByType.set(propRow.propType, propRow);
    if (propRow.flagged) playerLine.hasValue = true;
    players.set(propRow.playerId, playerLine);
  }
  const orderedPlayers = [...players.values()].filter((playerLine) => !valueOnly || playerLine.hasValue).filter((playerLine) => rowsLayout || columns.some((column) => playerLine.propsByType.has(column.propType))).sort((first, second) => second.minutesPlayed - first.minutesPlayed); // most minutes tonight first
  const openRow = openCell ? (rows.find((propRow) => propRow.playerId === openCell.playerId && propRow.propType === openCell.propType) ?? null) : null;
  const clockText = data.clock ? (data.clock.isHalftime ? "halftime" : `Q${Math.min(data.clock.period, 4)}`) : "";

  return (
    <div id="live-props" style={{ scrollMarginTop: 70 }}>
      <div className="row-between wrap" style={{ marginBottom: 8, gap: 8 }}>
        {rowsLayout ? (
          <span className="small muted">{orderedPlayers.length} players · tap a player</span>
        ) : (
          <Segmented
            options={[
              { value: "core", label: "Pts · Reb · Ast · 3PM" },
              { value: "combos", label: "Combos" },
            ]}
            value={columnSet}
            onChange={(nextSet) => setColumnSet(nextSet as ColumnSetName)}
            label="Columns"
          />
        )}
        <button className={`toggle-button${valueOnly ? " open" : ""}`} onClick={() => setValueOnly((previous) => !previous)}>
          {valueOnly ? "✓ Value" : "Value"} {data.valuePicks.length}
        </button>
      </div>
      {data.error ? <div className="notice">Live props unavailable: {data.error}</div> : null}
      {data.loading ? <div className="skeleton" /> : null}
      {!data.loading && rows.length === 0 ? <div className="empty-state">No live player props posted right now. Books often pull them during play.</div> : null}
      {rows.length > 0 && orderedPlayers.length === 0 ? <div className="empty-state">Nothing matches.</div> : null}
      {rowsLayout && orderedPlayers.length > 0 ? (
        <div className="live-rows">
          {orderedPlayers.map((playerLine) => (
            <PlayerRow key={playerLine.playerId} playerLine={playerLine} game={game} props={propList} gameOdds={gameOdds} threshold={settings.evThresholdPercent} onOpenMarket={(propRow) => setOpenCell({ playerId: propRow.playerId, propType: propRow.propType })} />
          ))}
        </div>
      ) : null}
      {!rowsLayout && orderedPlayers.length > 0 ? (
        <div className="prop-grid" role="table" aria-label="Live player props, now and line">
          <div className="prop-grid-row prop-grid-head" role="row">
            <span role="columnheader">Player</span>
            {columns.map((column) => (
              <span key={column.propType} role="columnheader">
                {column.header}
              </span>
            ))}
          </div>
          {orderedPlayers.map((playerLine) => (
            <div key={playerLine.playerId} className={`prop-grid-row${playerLine.inactiveNote ? " inactive" : ""}`} role="row">
              <span className="prop-grid-player" role="rowheader">
                <span className="prop-grid-name">{playerLine.shortName}</span>
                <span className="prop-grid-meta">
                  {playerLine.teamAbbreviation} · {playerLine.inactiveNote ? <span className="warning-text strong">OUT?</span> : `${formatNumber(playerLine.minutesPlayed, 0)}m`}
                  {playerLine.personalFouls >= 3 ? <span className="negative"> · {playerLine.personalFouls}pf</span> : null}
                </span>
              </span>
              {columns.map((column) => {
                const propRow = playerLine.propsByType.get(column.propType);
                if (!propRow) {
                  return (
                    <span key={column.propType} className="prop-cell empty" role="cell" aria-label="No line">
                      –
                    </span>
                  );
                }
                const selected = openCell?.playerId === propRow.playerId && openCell.propType === propRow.propType;
                const cashed = propRow.currentValue > propRow.lineValue;
                return (
                  <button key={column.propType} role="cell" className={`prop-cell${propRow.flagged ? " value" : ""}${selected ? " selected" : ""}${cashed ? " cashed" : ""}`} onClick={() => setOpenCell({ playerId: propRow.playerId, propType: propRow.propType })} aria-label={`${playerLine.playerName} ${propRow.label}: ${propRow.currentValue} now, line ${propRow.lineValue}`}>
                    <span className="prop-cell-now">{propRow.currentValue}</span>
                    <span className="prop-cell-line">{propRow.lineValue}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      <div className="faint small" style={{ marginTop: 8 }}>
        {rowsLayout ? "Green = value pick. Layout can be switched in Settings." : "Big number = now, small = line. Green = value pick. Tap a cell for prices and alt lines."}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="expand-hint">How projections work</summary>
        <p className="faint small">
          Projection = current stat + the pregame line for the time left (now at {clockText}), split by the player&apos;s usual quarters, nudged by tonight&apos;s pace (more late in games). Tonight&apos;s pace uses what his shots were worth, not lucky or unlucky makes; shot values come from his recent shot charts by distance. More or fewer shots than usual scale scoring props. The live total adjusts for game pace, and foul trouble or a blowout (score or live spread) trims minutes. EV shows only when the model is within {Math.round(maximumModelMarketGap * 100)} points of the de-vigged market. Players with no plays for a long stretch are never flagged.
        </p>
      </details>
      {openRow ? <PropSheet propRow={openRow} game={game} props={propList} gameOdds={gameOdds} threshold={settings.evThresholdPercent} onClose={() => setOpenCell(null)} /> : null}
    </div>
  );
}
