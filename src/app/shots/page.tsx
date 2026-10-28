"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShotCourt, type ZoneDisplay } from "@/components/shots/ShotCourt";
import { ShootingSpots } from "@/components/shots/ShootingSpots";
import { appSettings } from "@/config/appSettings";
import { Segmented } from "@/components/Segmented";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { TeamLogo } from "@/components/TeamLogo";
import { useAnalytics, useAnalyticsQuery } from "@/lib/client/hooks";
import { useSlate } from "@/lib/client/slateData";
import { findPlayer, searchPlayers, type PlayerProfile } from "@/lib/analytics/aggregates/playerAggregates";
import { compareZones, defaultShotSeason, defenseShotZones, leagueZoneRates, playerShotSeasons, playerShotZones, shotZoneSeasons, type ShotWindow, type ZoneComparison } from "@/lib/analytics/aggregates/shotZones";
import { shotZoneLabels, type ShotZoneKey } from "@/lib/data/shotZones";
import { teamById, teamReferences } from "@/lib/nba/teams";
import { formatNumber } from "@/lib/client/format";

const windowOptions: Array<{ value: ShotWindow; label: string }> = [
  { value: "season", label: "Season" },
  { value: "last10", label: "L10" },
  { value: "last5", label: "L5" },
];

const toneThreshold = 0.035; // make-rate points before a zone turns green or red

function percentText(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

function toneFor(difference: number | null): ZoneDisplay["tone"] {
  if (difference === null) return "empty";
  return difference >= toneThreshold ? "good" : difference <= -toneThreshold ? "bad" : "neutral";
}

function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, "0")}`;
}

export default function ShotsPage() {
  const { handle, status } = useAnalytics();
  const slate = useSlate();
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Array<PlayerProfile & { games: number }>>([]);
  const [chosenOpponent, setChosenOpponent] = useState<number | null>(null);
  const [chosenSeason, setChosenSeason] = useState<number | null>(null);
  const [playerWindow, setPlayerWindow] = useState<ShotWindow>("season");
  const [defenseWindow, setDefenseWindow] = useState<ShotWindow>("season");
  const [playerMode, setPlayerMode] = useState<"percent" | "volume">("percent");
  const [defenseMode, setDefenseMode] = useState<"percent" | "rank">("percent");
  const [selectedZone, setSelectedZone] = useState<ShotZoneKey | null>(null);

  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("player")); // deep link: /shots?player=123
    if (Number.isInteger(requested) && requested > 0) setPlayerId(requested);
  }, []);
  useEffect(() => {
    const trimmed = searchText.trim();
    if (!handle || trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const found = await searchPlayers(handle.engine, trimmed, 8);
      if (!cancelled) setSearchResults(found);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, handle]);

  const choosePlayer = (nextPlayerId: number) => {
    setPlayerId(nextPlayerId);
    setSearchText("");
    setChosenOpponent(null);
    setChosenSeason(null);
    setSelectedZone(null);
    window.history.replaceState(null, "", `/shots?player=${nextPlayerId}`);
  };

  const seasons = useAnalyticsQuery((analyticsHandle) => shotZoneSeasons(analyticsHandle.engine), "shot-seasons");
  const profile = useAnalyticsQuery(playerId ? (analyticsHandle) => findPlayer(analyticsHandle.engine, playerId) : null, `shot-player:${playerId}`);
  const playerSeasons = useAnalyticsQuery(playerId ? (analyticsHandle) => playerShotSeasons(analyticsHandle.engine, playerId) : null, `shot-player-seasons:${playerId}`);
  const autoSeason = defaultShotSeason(seasons.result ?? [], playerSeasons.result);
  const season = chosenSeason ?? autoSeason;
  const newestSeason = seasons.result?.[0] ?? null;
  const fellBack = chosenSeason === null && autoSeason !== null && newestSeason !== null && autoSeason !== newestSeason;
  const tonightGame = profile.result?.team_id ? (slate.data?.games ?? []).find((game) => game.home_team.id === profile.result!.team_id || game.visitor_team.id === profile.result!.team_id) : undefined;
  const tonightOpponent = tonightGame && profile.result ? (tonightGame.home_team.id === profile.result.team_id ? tonightGame.visitor_team.id : tonightGame.home_team.id) : null;
  const opponentId = chosenOpponent ?? tonightOpponent;
  const league = useAnalyticsQuery(season ? (analyticsHandle) => leagueZoneRates(analyticsHandle.engine, season) : null, `shot-league:${season}`);
  const playerZones = useAnalyticsQuery(playerId && season ? (analyticsHandle) => playerShotZones(analyticsHandle.engine, playerId, season, playerWindow) : null, `shot-zones:${playerId}:${season}:${playerWindow}`);
  const defense = useAnalyticsQuery(season ? (analyticsHandle) => defenseShotZones(analyticsHandle.engine, season, defenseWindow) : null, `shot-defense:${season}:${defenseWindow}`);
  const defenseLines = opponentId ? (defense.result?.get(opponentId) ?? null) : null;
  const comparisons: ZoneComparison[] | null = playerZones.result && league.result ? compareZones(playerZones.result.lines, defenseLines, league.result) : null;
  const opponent = opponentId ? teamById(opponentId) : undefined;
  const maxPerGame = Math.max(0.1, ...(comparisons ?? []).map((comparison) => comparison.player.perGame));

  const playerDisplays: Partial<Record<ShotZoneKey, ZoneDisplay>> = {};
  const defenseDisplays: Partial<Record<ShotZoneKey, ZoneDisplay>> = {};
  const matchupDisplays: Partial<Record<ShotZoneKey, ZoneDisplay>> = {};
  for (const comparison of comparisons ?? []) {
    const { zone, player, defense: defenseLine, leaguePercent } = comparison;
    if (playerMode === "volume") playerDisplays[zone] = { label: formatNumber(player.perGame, 1), tone: "volume", intensity: player.perGame / maxPerGame };
    else playerDisplays[zone] = player.attempts === 0 ? { label: "–", tone: "empty" } : { label: percentText(player.percent), tone: player.attempts < 3 || leaguePercent === null || comparison.playerShrunk === null ? "empty" : toneFor(comparison.playerShrunk - leaguePercent) };
    if (defenseLine) {
      const leakDifference = leaguePercent !== null && comparison.defenseShrunk !== null ? comparison.defenseShrunk - leaguePercent : null;
      defenseDisplays[zone] = defenseMode === "rank" ? { label: defenseLine.rank === null ? "–" : `#${defenseLine.rank}`, tone: defenseLine.rank === null ? "empty" : defenseLine.rank > defenseLine.teams * (2 / 3) ? "good" : defenseLine.rank <= defenseLine.teams / 3 ? "bad" : "neutral" } : { label: percentText(defenseLine.percent), tone: toneFor(leakDifference) };
    }
    matchupDisplays[zone] = player.attempts < 3 || comparison.edge === null ? { label: "–", tone: "empty" } : { label: `${comparison.edge >= 0 ? "+" : ""}${Math.round(comparison.edge * 100)}`, tone: toneFor(comparison.edge) };
  }
  const ranked = (comparisons ?? []).filter((comparison) => comparison.player.attempts >= 8 && comparison.edge !== null).sort((first, second) => (second.edge ?? 0) * Math.sqrt(second.shotShare) - (first.edge ?? 0) * Math.sqrt(first.shotShare));
  const bestSpots = ranked.filter((comparison) => (comparison.edge ?? 0) > 0).slice(0, 3);
  const worstSpots = [...ranked].reverse().filter((comparison) => (comparison.edge ?? 0) < 0).slice(0, 2);
  const selected = selectedZone ? (comparisons ?? []).find((comparison) => comparison.zone === selectedZone) : null;
  const playerName = profile.result ? `${profile.result.first_name} ${profile.result.last_name}` : "";
  const noShotData = seasons.result !== null && seasons.result.length === 0;

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Shots</h1>
          <p>Who has the shooting matchup tonight, and any player&apos;s shot map against any defense.</p>
        </div>
      </div>
      {noShotData ? (
        <div className="notice info">No shot zones yet. Run <code>npm run baseline:shots</code> once (GOAT tier) to load past games; new games are added automatically.</div>
      ) : null}
      {!handle ? <div className="faint small">Loading your local stats ({status.message})…</div> : null}

      {!noShotData ? (
        <ShootingSpots
          season={seasons.result ? (seasons.result.includes(appSettings.currentSeason) ? appSettings.currentSeason : (seasons.result[0] ?? null)) : null}
          onOpenMap={(nextPlayerId, nextOpponentId) => {
            choosePlayer(nextPlayerId);
            setChosenOpponent(nextOpponentId);
            document.getElementById("shot-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      ) : null}

      <div className="section-head" id="shot-map" style={{ scrollMarginTop: 70 }}>
        <div>
          <h2>Shot map</h2>
          <div className="faint small">One player against one defense, zone by zone.</div>
        </div>
      </div>
      <section className="card">
        <div className="shot-picker">
          {profile.result ? (
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <PlayerHeadshot playerId={profile.result.player_id} firstName={profile.result.first_name} lastName={profile.result.last_name} />
              <div style={{ minWidth: 0 }}>
                <div className="strong">{playerName}</div>
                <div className="faint small">
                  {teamById(profile.result.team_id ?? 0)?.full_name ?? ""} · <Link href={`/player/${profile.result.player_id}`}>player page</Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="faint small">Search for a player to load his shot map.</div>
          )}
          <input className="input" placeholder={playerId ? "Change player…" : "Search players…"} value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} aria-label="Search players" />
        </div>
        {searchResults.length > 0 ? (
          <div className="shot-search-results">
            {searchResults.map((result) => (
              <button key={result.player_id} className="shot-search-result" onClick={() => choosePlayer(result.player_id)}>
                <span className="strong">
                  {result.first_name} {result.last_name}
                </span>
                <span className="faint small">{teamById(result.team_id ?? 0)?.abbreviation ?? ""}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="shot-controls">
          <label className="small muted">
            Opponent
            <select className="input" value={opponentId ?? ""} onChange={(changeEvent) => setChosenOpponent(changeEvent.target.value ? Number(changeEvent.target.value) : null)}>
              <option value="">Choose a team</option>
              {teamReferences.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.full_name}
                  {team.id === tonightOpponent ? " (tonight)" : ""}
                </option>
              ))}
            </select>
          </label>
          {(seasons.result ?? []).length > 1 ? (
            <label className="small muted">
              Season
              <select className="input" value={season ?? ""} onChange={(changeEvent) => setChosenSeason(Number(changeEvent.target.value))}>
                {(seasons.result ?? []).map((seasonOption) => (
                  <option key={seasonOption} value={seasonOption}>
                    {seasonLabel(seasonOption)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {fellBack && newestSeason ? (
          <p className="faint small" style={{ marginBottom: 0 }}>
            Showing {seasonLabel(season!)}: only {playerSeasons.result?.get(newestSeason) ?? 0} game(s) this season so far. Switch the season to see them.
          </p>
        ) : null}
      </section>

      {playerId && comparisons ? (
        <>
          <div className="shot-panels">
            <section className="card shot-panel">
              <div className="shot-panel-title">
                <span className="strong">{playerName || "Player"}</span>
                <span className="faint small">{playerZones.result?.games ?? 0} games</span>
              </div>
              <Segmented options={windowOptions} value={playerWindow} onChange={setPlayerWindow} label="Player window" />
              <ShotCourt title="Player shots" zones={playerDisplays} selectedZone={selectedZone} onSelect={setSelectedZone} />
              <Segmented
                options={[
                  { value: "percent", label: "FG%" },
                  { value: "volume", label: "Attempts / game" },
                ]}
                value={playerMode}
                onChange={setPlayerMode}
                label="Player view"
              />
            </section>
            <section className="card shot-panel">
              <div className="shot-panel-title">
                <span className="row" style={{ gap: 8 }}>
                  {opponent ? <TeamLogo teamId={opponent.id} /> : null}
                  <span className="strong">{opponent ? `${opponent.abbreviation} defense` : "Defense"}</span>
                </span>
                <span className="faint small">allowed</span>
              </div>
              <Segmented options={windowOptions} value={defenseWindow} onChange={setDefenseWindow} label="Defense window" />
              {opponent ? <ShotCourt title="Defense allowed" zones={defenseDisplays} selectedZone={selectedZone} onSelect={setSelectedZone} /> : <div className="empty-state">Pick an opponent above.</div>}
              <Segmented
                options={[
                  { value: "percent", label: "FG% allowed" },
                  { value: "rank", label: "Rank" },
                ]}
                value={defenseMode}
                onChange={setDefenseMode}
                label="Defense view"
              />
            </section>
            <section className="card shot-panel">
              <div className="shot-panel-title">
                <span className="strong">Matchup edge</span>
                <span className="faint small">pts of FG% vs league</span>
              </div>
              <ShotCourt title="Matchup edge" zones={matchupDisplays} selectedZone={selectedZone} onSelect={setSelectedZone} />
              <p className="faint small" style={{ margin: 0 }}>
                Green = he beats the league here and/or {opponent?.abbreviation ?? "they"} allow more than the league. Small samples are pulled toward league average.
              </p>
            </section>
          </div>

          {selected ? (
            <section className="card">
              <div className="card-header">
                <h2>{shotZoneLabels[selected.zone]}</h2>
                <button className="icon-button" onClick={() => setSelectedZone(null)} aria-label="Close zone details">
                  ✕
                </button>
              </div>
              <div className="sheet-stats">
                <div>
                  <span>{playerName.split(" ").at(-1) ?? "Player"}</span>
                  <strong>{percentText(selected.player.percent)}</strong>
                  <span>
                    {selected.player.makes}/{selected.player.attempts} · {formatNumber(selected.player.perGame, 1)}/g
                  </span>
                </div>
                <div>
                  <span>League</span>
                  <strong>{percentText(selected.leaguePercent)}</strong>
                  <span>{Math.round(selected.shotShare * 100)}% of his shots</span>
                </div>
                <div>
                  <span>{opponent?.abbreviation ?? "Defense"} allows</span>
                  <strong>{percentText(selected.defense?.percent ?? null)}</strong>
                  <span>{selected.defense?.rank ? `rank ${selected.defense.rank} of ${selected.defense.teams}` : "no data"}</span>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card">
            <div className="card-header">
              <h2>Where to look</h2>
              <span className="faint small">zones with 8+ attempts</span>
            </div>
            {bestSpots.length === 0 && worstSpots.length === 0 ? <div className="faint small">Not enough shots in this window yet.</div> : null}
            <div className="spot-list">
              {[...bestSpots.map((comparison) => ({ comparison, good: true })), ...worstSpots.map((comparison) => ({ comparison, good: false }))].map(({ comparison, good }) => (
                <button key={comparison.zone} className={`spot-row ${good ? "good" : "bad"}`} onClick={() => setSelectedZone(comparison.zone)}>
                  <span className="spot-edge">
                    {(comparison.edge ?? 0) >= 0 ? "+" : ""}
                    {Math.round((comparison.edge ?? 0) * 100)}
                  </span>
                  <span className="spot-text">
                    <span className="strong">{shotZoneLabels[comparison.zone]}</span>
                    <span className="faint small">
                      He shoots {percentText(comparison.player.percent)} ({formatNumber(comparison.player.perGame, 1)}/g) vs league {percentText(comparison.leaguePercent)}
                      {comparison.defense ? ` · ${opponent?.abbreviation} allow ${percentText(comparison.defense.percent)}${comparison.defense.rank ? ` (#${comparison.defense.rank})` : ""}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : playerId && handle ? (
        <div className="skeleton" />
      ) : null}
      <p className="faint small">Zones follow the NBA&apos;s shot-chart areas. Shot charts arrive after each game ends, so tonight&apos;s shots show up tomorrow. Rank 1 = the defense allowing the lowest FG% in that zone.</p>
    </main>
  );
}
