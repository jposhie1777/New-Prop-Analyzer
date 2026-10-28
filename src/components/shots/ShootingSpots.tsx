"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { TeamLogo } from "@/components/TeamLogo";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { ShotCourt, type ZoneDisplay } from "@/components/shots/ShotCourt";
import { useAnalyticsQuery } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { fetchApi } from "@/lib/client/apiClient";
import { buildShootingSpots, filteredBoost, loadSlateShotData, zoneInFilter, type PlayerSpot, type SpotFilter } from "@/lib/analytics/aggregates/shotMatchups";
import type { ShotWindow } from "@/lib/analytics/aggregates/shotZones";
import { shotZoneLabels, type ShotZoneKey } from "@/lib/data/shotZones";
import { isGameFinal } from "@/lib/data/flatten";
import { teamById } from "@/lib/nba/teams";
import { formatTipoff } from "@/lib/dates";
import { formatAmerican } from "@/lib/math/odds";
import { formatNumber } from "@/lib/client/format";
import type { BdlPlayerProp } from "@/lib/bdl/types";

type SpotView = "players" | "defenses";
type SpotOrder = "best" | "toughest";

const shownRows = 12; // the rest sit behind a button

function points(rate: number): string {
  return `${rate >= 0 ? "+" : ""}${Math.round(rate * 100)}`;
}

function signed(value: number, digits = 1): string {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return formatNumber(0, digits); // no "-0.0"
  return `${value >= 0 ? "+" : ""}${formatNumber(value, digits)}`;
}

function shortZone(zone: ShotZoneKey): string {
  return shotZoneLabels[zone].replace(" (non-RA)", "");
}

function mainLine(props: BdlPlayerProp[], playerId: number, propType: string): { line: number; odds: number } | null {
  const offers = props.flatMap((prop) => (prop.player_id === playerId && prop.prop_type === propType && prop.market.type === "over_under" && typeof prop.market.over_odds === "number" ? [{ lineValue: Number(prop.line_value), overOdds: prop.market.over_odds }] : []));
  if (offers.length === 0) return null;
  const lineCounts = new Map<number, number>();
  for (const offer of offers) lineCounts.set(offer.lineValue, (lineCounts.get(offer.lineValue) ?? 0) + 1);
  const line = [...lineCounts.entries()].sort((first, second) => second[1] - first[1] || first[0] - second[0])[0][0]; // the line most books post
  const odds = Math.max(...offers.filter((offer) => offer.lineValue === line).map((offer) => offer.overOdds));
  return { line, odds };
}

function SpotDetail({ spot, filter, onOpenMap }: { spot: PlayerSpot; filter: SpotFilter; onOpenMap: (playerId: number, opponentId: number) => void }) {
  const [props, setProps] = useState<BdlPlayerProp[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchApi<{ data: BdlPlayerProp[] }>(`/api/props?game_id=${spot.gameId}`).then(
      (body) => !cancelled && setProps(body.data ?? []),
      () => !cancelled && setProps([]),
    );
    return () => {
      cancelled = true;
    };
  }, [spot.gameId]);
  const opponent = teamById(spot.opponentId);
  const displays: Partial<Record<ShotZoneKey, ZoneDisplay>> = {};
  for (const spotZone of spot.zones) {
    const combined = spotZone.skill + spotZone.leak;
    displays[spotZone.zone] = spotZone.attempts < 3 ? { label: "–", tone: "empty" } : { label: points(combined), tone: spotZone.sweet || combined >= 0.035 ? "good" : combined <= -0.035 ? "bad" : "neutral" };
  }
  const threes = props ? mainLine(props, spot.playerId, "threes") : null;
  const pointsLine = props ? mainLine(props, spot.playerId, "points") : null;
  return (
    <div className="spot-detail">
      <div className="spot-detail-court">
        <ShotCourt title={`${spot.name} vs ${opponent?.abbreviation ?? ""}`} zones={displays} selectedZone={null} onSelect={() => undefined} />
        <p className="faint small" style={{ margin: "6px 0 0" }}>
          Green: he shoots well there and/or {opponent?.abbreviation ?? "they"} allow a lot. Numbers are make-rate points over league, his plus theirs.
        </p>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="table-scroll" style={{ margin: 0, padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>His FGA/g</th>
                <th>His FG%</th>
                <th>{opponent?.abbreviation ?? "Opp"} allows</th>
                <th>Boost</th>
              </tr>
            </thead>
            <tbody>
              {spot.zones
                .filter((spotZone) => zoneInFilter(spotZone.zone, filter))
                .map((spotZone) => (
                  <tr key={spotZone.zone} className={spotZone.sweet ? "sweet-row" : ""}>
                    <td className={spotZone.sweet ? "strong" : ""}>{shortZone(spotZone.zone)}</td>
                    <td>{formatNumber(spotZone.perGame, 1)}</td>
                    <td>
                      {Math.round(spotZone.playerRate * 100)}% <span className={spotZone.skill >= 0.03 ? "positive" : spotZone.skill <= -0.03 ? "negative" : "sub"}>{points(spotZone.skill)}</span>
                    </td>
                    <td>
                      {Math.round(spotZone.defenseRate * 100)}% <span className={spotZone.leak >= 0.02 ? "positive" : spotZone.leak <= -0.02 ? "negative" : "sub"}>{spotZone.defenseRank ? `#${spotZone.defenseRank}` : ""}</span>
                    </td>
                    <td className={spotZone.boost >= 0.05 ? "positive" : spotZone.boost <= -0.05 ? "negative" : ""}>{signed(spotZone.boost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {props === null ? <span className="faint small">Loading lines…</span> : null}
          {threes ? (
            <span className={`pill${spot.threeBoost >= 0.15 ? " positive" : spot.threeBoost <= -0.15 ? " negative" : ""}`}>
              3PM o{threes.line} {formatAmerican(threes.odds)} · boost {signed(spot.threeBoost)}
            </span>
          ) : null}
          {pointsLine ? (
            <span className={`pill${spot.boost >= 0.8 ? " positive" : spot.boost <= -0.8 ? " negative" : ""}`}>
              Points o{pointsLine.line} {formatAmerican(pointsLine.odds)} · boost {signed(spot.boost)}
            </span>
          ) : null}
          {props && !threes && !pointsLine ? <span className="faint small">No lines posted yet.</span> : null}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="button small" onClick={() => onOpenMap(spot.playerId, spot.opponentId)}>
            Open full shot map
          </button>
          <Link href={`/player/${spot.playerId}`} className="button small ghost">
            Player page
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ShootingSpots({ season, onOpenMap }: { season: number | null; onOpenMap: (playerId: number, opponentId: number) => void }) {
  const slate = useSlate();
  const [view, setView] = useState<SpotView>("players");
  const [filter, setFilter] = useState<SpotFilter>("all");
  const [order, setOrder] = useState<SpotOrder>("best");
  const [shotWindow, setShotWindow] = useState<ShotWindow>("season");
  const [openPlayer, setOpenPlayer] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const games = (slate.data?.games ?? []).filter((game) => !isGameFinal(game));
  const matchups = games.flatMap((game) => [
    { teamId: game.visitor_team.id, opponentId: game.home_team.id, gameId: game.id },
    { teamId: game.home_team.id, opponentId: game.visitor_team.id, gameId: game.id },
  ]);
  const teamIds = matchups.map((matchup) => matchup.teamId);
  const data = useAnalyticsQuery(season && teamIds.length > 0 ? (handle) => loadSlateShotData(handle.engine, teamIds, season, shotWindow) : null, `shooting-spots:${season}:${shotWindow}:${teamIds.join(",")}`);
  const outIds = new Set((slate.data?.injuries ?? []).filter((injury) => /out/i.test(injury.status)).map((injury) => injury.player.id)); // listed out: skip
  const built = data.result ? buildShootingSpots(data.result, matchups, outIds) : null;
  const gameById = new Map(games.map((game) => [game.id, game]));
  const ranked = [...(built?.players ?? [])].sort((first, second) => (order === "best" ? filteredBoost(second, filter) - filteredBoost(first, filter) : filteredBoost(first, filter) - filteredBoost(second, filter)));
  const shown = showAll ? ranked : ranked.slice(0, shownRows);
  const sampleGames = data.result ? Math.max(0, ...[...data.result.defenses.values()].map((defense) => defense.games)) : 0;

  return (
    <section className="shooting-spots">
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <h2>Shooting spots tonight</h2>
          <div className="faint small">
            Who shoots where tonight&apos;s defense gives up makes · players with 6+ shots a game{sampleGames > 0 && sampleGames < 10 ? ` · early season: last season fills in until teams have more games` : ""}
          </div>
        </div>
        <Segmented
          label="Shooting spots view"
          options={[
            { value: "players", label: "Players" },
            { value: "defenses", label: "Defenses" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      {games.length === 0 && !slate.loading ? <div className="card empty-state">No games left tonight.</div> : null}
      {data.loading && games.length > 0 ? <div className="skeleton" /> : null}
      {view === "players" && built ? (
        <>
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <Segmented
              label="Shot type"
              options={[
                { value: "all", label: "All shots" },
                { value: "three", label: "3-pointers" },
                { value: "inside", label: "Inside" },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <Segmented
              label="Order"
              options={[
                { value: "best", label: "Best" },
                { value: "toughest", label: "Toughest" },
              ]}
              value={order}
              onChange={setOrder}
            />
            <Segmented
              label="Window"
              options={[
                { value: "season", label: "Season" },
                { value: "last10", label: "L10" },
              ]}
              value={shotWindow}
              onChange={setShotWindow}
            />
          </div>
          <div className="card flush ledger-list spots-list">
            <div className="ledger-head" aria-hidden>
              <span>#</span>
              <span>Player</span>
              <span className="hide-narrow">Game</span>
              <span className="numeric">Boost</span>
              <span className="numeric hide-narrow">3PM</span>
              <span className="hide-narrow">Sweet spots</span>
              <span />
            </div>
            {shown.map((spot, rankIndex) => {
              const game = gameById.get(spot.gameId);
              const team = teamById(spot.teamId);
              const opponent = teamById(spot.opponentId);
              const isHome = game?.home_team.id === spot.teamId;
              const value = filteredBoost(spot, filter);
              const sweetSpots = spot.zones.filter((spotZone) => spotZone.sweet && zoneInFilter(spotZone.zone, filter));
              const isOpen = openPlayer === spot.playerId;
              const [firstName, ...restName] = spot.name.split(" ");
              return (
                <div key={spot.playerId} className={`ledger-item${isOpen ? " open" : ""}`}>
                  <button className="ledger-row" onClick={() => setOpenPlayer(isOpen ? null : spot.playerId)} aria-expanded={isOpen}>
                    <span className="faint strong tabular">{rankIndex + 1}</span>
                    <span className="row" style={{ gap: 10, minWidth: 0 }}>
                      <PlayerHeadshot playerId={spot.playerId} firstName={firstName} lastName={restName.join(" ")} />
                      <span style={{ minWidth: 0 }}>
                        <span className="strong spots-name">{spot.name}</span>
                        <span className="faint small spots-meta">
                          {team?.abbreviation} {isHome ? "vs" : "@"} {opponent?.abbreviation} · {formatNumber(spot.shotsPerGame, 1)} FGA
                        </span>
                      </span>
                    </span>
                    <span className="faint small hide-narrow row" style={{ gap: 6 }}>
                      <TeamLogo teamId={spot.opponentId} />
                      {game ? formatTipoff(game.datetime).replace(" ET", "") : ""}
                    </span>
                    <span className="numeric">
                      <span className={`spots-boost ${value >= 0.3 ? "positive" : value <= -0.3 ? "negative" : ""}`}>{signed(value)}</span>
                      <span className="faint small"> pts</span>
                    </span>
                    <span className={`numeric mono hide-narrow ${spot.threeBoost >= 0.15 ? "positive" : spot.threeBoost <= -0.15 ? "negative" : "faint"}`}>{signed(spot.threeBoost)}</span>
                    <span className="chip-row spots-chips">
                      {sweetSpots.slice(0, 3).map((spotZone) => (
                        <span key={spotZone.zone} className="pill positive">
                          {shortZone(spotZone.zone)}
                        </span>
                      ))}
                      {sweetSpots.length === 0 && order === "toughest"
                        ? spot.zones
                            .filter((spotZone) => spotZone.leak <= -0.02 && spotZone.perGame >= 1.5 && zoneInFilter(spotZone.zone, filter))
                            .slice(0, 2)
                            .map((spotZone) => (
                              <span key={spotZone.zone} className="pill negative">
                                {shortZone(spotZone.zone)}
                              </span>
                            ))
                        : null}
                    </span>
                    <span className="ledger-chevron">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  {isOpen ? <SpotDetail spot={spot} filter={filter} onOpenMap={onOpenMap} /> : null}
                </div>
              );
            })}
            {ranked.length === 0 ? <div className="empty-state">No players with enough shots yet.</div> : null}
          </div>
          {ranked.length > shownRows ? (
            <button className="button ghost" style={{ marginTop: 10 }} onClick={() => setShowAll((shownBefore) => !shownBefore)}>
              {showAll ? "Show top 12" : `Show all ${ranked.length}`}
            </button>
          ) : null}
          <p className="faint small">
            Boost = extra points tonight vs an average defense: his shots a game from each zone × how far over the league the defense allows there × 2 or 3. 3PM = the same in made threes. Sweet spot = 1.5+ shots a game, he beats the league and they allow more than the league. Small samples lean on last season, then the league.
          </p>
        </>
      ) : null}
      {view === "defenses" && built ? (
        <div className="card-grid">
          {built.defenses.map((defense) => {
            const team = teamById(defense.teamId);
            const opponent = teamById(defense.opponentId);
            const game = gameById.get(defense.gameId);
            return (
              <article key={defense.teamId} className="card defense-leak">
                <div className="row-between">
                  <span className="row strong">
                    <TeamLogo teamId={defense.teamId} />
                    {team?.full_name}
                  </span>
                  <span className="faint small">
                    vs {opponent?.abbreviation} · {game ? formatTipoff(game.datetime).replace(" ET", "") : ""}
                  </span>
                </div>
                {defense.zones.map((leakZone) => (
                  <div key={leakZone.zone} className="defense-leak-zone">
                    <div className="row-between">
                      <span>{shortZone(leakZone.zone)}</span>
                      <span className={`pill${leakZone.leak >= 0.02 ? " positive" : ""}`}>
                        {Math.round(leakZone.rate * 100)}% · {points(leakZone.leak)} · #{leakZone.rank}
                      </span>
                    </div>
                    <div className="faint small">{leakZone.attackers.length > 0 ? leakZone.attackers.map((attacker) => `${attacker.name.split(" ").at(-1)} ${formatNumber(attacker.perGame, 1)}/g`).join(", ") : `No ${opponent?.abbreviation ?? ""} regular shoots here much`}</div>
                  </div>
                ))}
              </article>
            );
          })}
          <p className="faint small" style={{ gridColumn: "1 / -1", margin: 0 }}>
            Make rate allowed in each zone vs league, ranked of 30 (30 = allows the most), with the opponents who shoot there most.
          </p>
        </div>
      ) : null}
    </section>
  );
}
