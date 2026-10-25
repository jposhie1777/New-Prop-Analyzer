"use client";

import { booksKey } from "@/lib/client/bookFilter";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { TeamLogo } from "@/components/TeamLogo";
import { WindowAveragesCard } from "@/components/player/WindowAveragesCard";
import { GameLogCard } from "@/components/player/GameLogCard";
import { PropHitRates } from "@/components/player/PropHitRates";
import { MatchupCard } from "@/components/player/MatchupCard";
import { UsageShiftCard } from "@/components/player/UsageShiftCard";
import { useAnalyticsQuery, useSettings, useVisiblePolling } from "@/lib/client/hooks";
import { loadProps, useSlate } from "@/lib/client/slateData";
import { findPlayer, playerGameLog, playerHitRates, playerPositionGroup, playerWindowAggregates, type PlayerGameLogRow } from "@/lib/analytics/aggregates/playerAggregates";
import { defenseVsPosition } from "@/lib/analytics/aggregates/defenseVsPosition";
import { usageShift } from "@/lib/analytics/aggregates/usageShift";
import { summarizePropMarkets } from "@/lib/client/pickBuilders";
import { appSettings } from "@/config/appSettings";
import { teamById } from "@/lib/nba/teams";
import { formatTipoff } from "@/lib/dates";
import { fetchApi } from "@/lib/client/apiClient";
import type { BdlPlayer } from "@/lib/bdl/types";

const seasons = [appSettings.currentSeason, appSettings.lastSeason];

export default function PlayerPage() {
  const params = useParams<{ playerId: string }>();
  const playerId = Number(params.playerId);
  const slate = useSlate();
  const settings = useSettings();

  const profile = useAnalyticsQuery(async (handle) => {
    const fromDuck = await findPlayer(handle.engine, playerId);
    if (fromDuck) return fromDuck;
    const body = await fetchApi<{ data: BdlPlayer[] }>(`/api/players?ids=${playerId}`); // rookies with no games yet
    const player = body.data[0];
    return player ? { player_id: player.id, first_name: player.first_name, last_name: player.last_name, position: player.position, team_id: player.team?.id ?? null, jersey_number: player.jersey_number } : null;
  }, `profile:${playerId}`);
  const windows = useAnalyticsQuery((handle) => playerWindowAggregates(handle.engine, playerId, seasons), `windows:${playerId}`);
  const logs = useAnalyticsQuery(async (handle) => {
    const bySeason: Record<number, PlayerGameLogRow[]> = {};
    for (const season of seasons) bySeason[season] = await playerGameLog(handle.engine, playerId, season);
    return bySeason;
  }, `logs:${playerId}`);
  const positionGroup = useAnalyticsQuery((handle) => playerPositionGroup(handle.engine, playerId), `position:${playerId}`);

  const teamId = profile.result?.team_id ?? null;
  const tonightGame = slate.data?.games.find((game) => teamId !== null && (game.home_team.id === teamId || game.visitor_team.id === teamId)) ?? null;
  const opponentId = tonightGame ? (tonightGame.home_team.id === teamId ? tonightGame.visitor_team.id : tonightGame.home_team.id) : null;

  const props = useVisiblePolling(tonightGame ? () => loadProps(tonightGame.id, false, settings.enabledBooks) : null, appSettings.slatePollIntervalMs, `props:${tonightGame?.id ?? "none"}:${booksKey(settings.enabledBooks)}`);
  const playerProps = (props.data ?? []).filter((prop) => prop.player_id === playerId);
  const summaries = summarizePropMarkets(playerProps);
  const allLines = summaries.flatMap((summary) => [...new Set([summary.mainLine, ...summary.ladder.map((rung) => rung.line), ...summary.milestones.map((milestone) => milestone.threshold - 0.5)])].map((lineValue) => ({ propType: summary.propType, lineValue }))); // main, alternate and milestone lines
  const linesKey = allLines.map((propLine) => `${propLine.propType}:${propLine.lineValue}`).join(",");
  const hitRates = useAnalyticsQuery(allLines.length > 0 ? (handle) => playerHitRates(handle.engine, playerId, allLines) : null, `hits:${playerId}:${linesKey}`);
  const defense = useAnalyticsQuery(opponentId ? (handle) => defenseVsPosition(handle.engine, appSettings.currentSeason) : null, `defense:${opponentId}`);

  const injuredTeammates = (slate.data?.injuries ?? []).filter((injury) => teamId !== null && (injury.player.team?.id ?? injury.player.team_id) === teamId && injury.player.id !== playerId);
  const teammateKey = injuredTeammates.map((injury) => injury.player.id).join(",");
  const shifts = useAnalyticsQuery(injuredTeammates.length > 0 ? (handle) => usageShift(handle.engine, playerId, injuredTeammates.map((injury) => injury.player.id), seasons) : null, `usage:${playerId}:${teammateKey}`);

  const player = profile.result;
  const team = teamId ? teamById(teamId) : undefined;
  const playerName = player ? `${player.first_name} ${player.last_name}` : "";

  if (!Number.isInteger(playerId) || playerId <= 0) return <main className="page"><div className="card empty-state">Unknown player.</div></main>;

  return (
    <main className="page">
      <section className="card row" style={{ gap: 14, marginBottom: 12 }}>
        {player ? <PlayerHeadshot playerId={playerId} firstName={player.first_name} lastName={player.last_name} large /> : <span className="headshot-fallback large">…</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.02em" }}>{player ? playerName : profile.loading ? "Loading…" : "Player not found"}</h1>
          <div className="row wrap muted small" style={{ marginTop: 4 }}>
            {team ? <TeamLogo teamId={team.id} /> : null}
            <span>{team?.full_name ?? "Free agent"}</span>
            <span>·</span>
            <span>{player?.position || "-"}</span>
            {player?.jersey_number ? <span>· #{player.jersey_number}</span> : null}
            {positionGroup.result ? <span className="pill">plays {positionGroup.result}</span> : null}
          </div>
          {tonightGame ? (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="pill accent">
                Tonight {tonightGame.home_team.id === teamId ? "vs" : "@"} {teamById(opponentId!)?.abbreviation} · {formatTipoff(tonightGame.datetime)}
              </span>
            </div>
          ) : (
            <div className="faint small" style={{ marginTop: 8 }}>
              No game today
            </div>
          )}
        </div>
      </section>

      {tonightGame && player ? (
        <section className="card">
          <div className="card-header">
            <h2>Tonight&apos;s lines · hit rates</h2>
            <span className="faint small">most recent games, both seasons</span>
          </div>
          {props.loading && !props.data ? <div className="skeleton" /> : <PropHitRates game={tonightGame} playerId={playerId} playerName={playerName} summaries={summaries} hitRates={hitRates.result ?? []} props={props.data ?? []} gameOdds={slate.data?.odds ?? []} />}
        </section>
      ) : null}

      <div className="grid-two" style={{ marginTop: 12 }}>
        <WindowAveragesCard table={windows.result} seasons={seasons} />
        <div className="stack" style={{ gap: 12 }}>
          {opponentId ? <MatchupCard table={defense.result} opponentId={opponentId} positionGroup={positionGroup.result ?? "F"} /> : null}
          {teamId ? <UsageShiftCard shifts={shifts.result ?? []} injuries={injuredTeammates} /> : null}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <GameLogCard logsBySeason={logs.result ?? {}} seasons={seasons} loading={logs.loading} />
      </div>
      <p className="faint small" style={{ marginTop: 12 }}>
        <Link href="/players">← Search another player</Link>
      </p>
    </main>
  );
}
