"use client";

import { useSnapshotOrQuery } from "./siteSnapshot";
import { useEffect, useMemo } from "react";
import { booksKey } from "./bookFilter";
import { useSettings, useVisiblePolling } from "./hooks";
import { loadProps } from "./slateData";
import { quarterProfiles } from "@/lib/analytics/aggregates/playerAggregates";
import { buildLivePropRows, type LivePropRow } from "@/lib/analytics/liveSuggestions";
import { clockLabel, parseGameClock, timeShares, type GameClock } from "@/lib/analytics/liveProjection";
import { buildShotProfiles, parseLivePlays, readLiveMarket, type MarketRead } from "@/lib/analytics/liveSignals";
import { recentTeamGameIds } from "@/lib/analytics/aggregates/teamAggregates";
import { fetchApi } from "./apiClient";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { livePropToTracked } from "@/lib/tracking/fromSources";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlay, BdlPlayerProp, BdlShotChartRow } from "@/lib/bdl/types";

export interface LivePropData {
  rows: LivePropRow[];
  clock: GameClock | null;
  props: BdlPlayerProp[];
  loading: boolean;
  error: string | null;
  valuePicks: LivePropRow[];
  market: MarketRead | null;
  playsLoaded: boolean;
  shotChartPlayers: number;
}

interface ListResponse<ItemType> {
  data?: ItemType[];
  unavailable?: boolean;
}

async function loadShotCharts(recentByTeam: Map<number, number[]>): Promise<BdlShotChartRow[]> {
  const responses = await Promise.all([...recentByTeam].filter(([, gameIds]) => gameIds.length > 0).map(([teamId, gameIds]) => fetchApi<ListResponse<BdlShotChartRow>>(`/api/shot-charts?team_id=${teamId}&game_ids=${gameIds.join(",")}`).catch(() => ({ data: [] }))));
  return responses.flatMap((response) => response.data ?? []);
}

export function useLivePropData(game: BdlGame, boxScore: BdlBoxScore | null, active: boolean, liveOdds: BdlBettingOdd[] = [], openingOdds: BdlBettingOdd[] = []): LivePropData {
  const settings = useSettings();
  const props = useVisiblePolling(active ? () => loadProps(game.id, false, settings.enabledBooks) : null, 60_000, `live-props:${game.id}:${booksKey(settings.enabledBooks)}:${active}`); // live lines, 60s like the CDN cache
  const openingProps = useVisiblePolling(active ? () => loadProps(game.id, true) : null, 600_000, `opening-props:${game.id}:${active}`); // pregame lines from every book anchor the projection
  const playerIds = boxScore ? [...boxScore.home_team.players, ...boxScore.visitor_team.players].map((boxPlayer) => boxPlayer.player.id) : [];
  const profiles = useSnapshotOrQuery((snapshot) => snapshot.quarterProfiles, active && playerIds.length > 0 ? (handle) => quarterProfiles(handle.engine, playerIds, 10) : null, `quarters:${game.id}:${playerIds.length}`);
  const plays = useVisiblePolling(active ? async () => (await fetchApi<ListResponse<BdlPlay>>(`/api/plays?game_id=${game.id}`)).data ?? [] : null, 60_000, `plays:${game.id}:${active}`); // who is on the floor, fouls, shot locations
  const teamIds = [game.home_team.id, game.visitor_team.id];
  const recentGames = useSnapshotOrQuery((snapshot) => snapshot.recentTeamGameIds, active ? (handle) => recentTeamGameIds(handle.engine, teamIds, 10) : null, `recent-games:${game.id}:${active}`);
  const recentKey = recentGames.result ? [...recentGames.result].map(([teamId, gameIds]) => `${teamId}:${gameIds.join(".")}`).join("|") : "";
  const shotCharts = useVisiblePolling(active && recentGames.result ? () => loadShotCharts(recentGames.result!) : null, null, `shot-charts:${recentKey}`); // finished games, fetched once
  const shotProfiles = useMemo(() => (shotCharts.data ? buildShotProfiles(shotCharts.data) : null), [shotCharts.data]);
  const activity = useMemo(() => {
    if (!boxScore || !plays.data || plays.data.length === 0) return null;
    const boxPlayers = [...boxScore.home_team.players, ...boxScore.visitor_team.players];
    return parseLivePlays(plays.data, boxPlayers.map((boxPlayer) => ({ id: boxPlayer.player.id, name: `${boxPlayer.player.first_name} ${boxPlayer.player.last_name}` })));
  }, [plays.data, boxScore]);
  const clockNow = boxScore ? parseGameClock(boxScore.status, boxScore.time, boxScore.period) : null;
  const market = boxScore && clockNow ? readLiveMarket(liveOdds.filter((bettingOdd) => bettingOdd.game_id === game.id), openingOdds.filter((bettingOdd) => bettingOdd.game_id === game.id), boxScore.home_team_score + boxScore.visitor_team_score, timeShares(clockNow, { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 }).remainingClock, game.datetime) : null;
  const built = active && boxScore ? buildLivePropRows(boxScore, props.data ?? [], openingProps.data ?? [], profiles.result ?? new Map(), settings.evThresholdPercent, { activity, shotProfiles, market }) : { rows: [], clock: null };
  const valuePicks = built.rows.filter((propRow) => propRow.flagged).sort((first, second) => (second.evaluation.bestEvPercent ?? 0) - (first.evaluation.bestEvPercent ?? 0));
  const valueKey = valuePicks.map((propRow) => `${propRow.playerId}:${propRow.propType}`).join(",");
  useEffect(() => {
    if (!boxScore || !profiles.result || valuePicks.length === 0 || !built.clock) return;
    const source = built.clock.isHalftime ? "halftime" : "live";
    trackPicks(valuePicks.map((propRow) => livePropToTracked(propRow, game.id, game.date, clockLabel(boxScore.status, boxScore.time), source))); // graded later on the Record page
  }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows: built.rows, clock: built.clock, props: props.data ?? [], loading: props.loading && !props.data, error: props.error, valuePicks, market, playsLoaded: Boolean(activity), shotChartPlayers: shotProfiles?.size ?? 0 };
}
