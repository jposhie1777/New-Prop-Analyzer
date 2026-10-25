"use client";

import { useEffect } from "react";
import { booksKey } from "./bookFilter";
import { useAnalyticsQuery, useSettings, useVisiblePolling } from "./hooks";
import { loadProps } from "./slateData";
import { quarterProfiles } from "@/lib/analytics/aggregates/playerAggregates";
import { buildLivePropRows, type LivePropRow } from "@/lib/analytics/liveSuggestions";
import { clockLabel, type GameClock } from "@/lib/analytics/liveProjection";
import { trackPicks } from "@/lib/tracking/trackerStore";
import { livePropToTracked } from "@/lib/tracking/fromSources";
import type { BdlBoxScore, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";

export interface LivePropData {
  rows: LivePropRow[];
  clock: GameClock | null;
  props: BdlPlayerProp[];
  loading: boolean;
  error: string | null;
  valuePicks: LivePropRow[];
}

export function useLivePropData(game: BdlGame, boxScore: BdlBoxScore | null, active: boolean): LivePropData {
  const settings = useSettings();
  const props = useVisiblePolling(active ? () => loadProps(game.id, false, settings.enabledBooks) : null, 60_000, `live-props:${game.id}:${booksKey(settings.enabledBooks)}:${active}`); // live lines, 60s like the CDN cache
  const openingProps = useVisiblePolling(active ? () => loadProps(game.id, true) : null, 600_000, `opening-props:${game.id}:${active}`); // pregame lines from every book anchor the projection
  const playerIds = boxScore ? [...boxScore.home_team.players, ...boxScore.visitor_team.players].map((boxPlayer) => boxPlayer.player.id) : [];
  const profiles = useAnalyticsQuery(active && playerIds.length > 0 ? (handle) => quarterProfiles(handle.engine, playerIds, 10) : null, `quarters:${game.id}:${playerIds.length}`);
  const built = active && boxScore ? buildLivePropRows(boxScore, props.data ?? [], openingProps.data ?? [], profiles.result ?? new Map(), settings.evThresholdPercent) : { rows: [], clock: null };
  const valuePicks = built.rows.filter((propRow) => propRow.flagged).sort((first, second) => (second.evaluation.bestEvPercent ?? 0) - (first.evaluation.bestEvPercent ?? 0));
  const valueKey = valuePicks.map((propRow) => `${propRow.playerId}:${propRow.propType}`).join(",");
  useEffect(() => {
    if (!boxScore || !profiles.result || valuePicks.length === 0 || !built.clock) return;
    const source = built.clock.isHalftime ? "halftime" : "live";
    trackPicks(valuePicks.map((propRow) => livePropToTracked(propRow, game.id, game.date, clockLabel(boxScore.status, boxScore.time), source))); // graded later on the Record page
  }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows: built.rows, clock: built.clock, props: props.data ?? [], loading: props.loading && !props.data, error: props.error, valuePicks };
}
