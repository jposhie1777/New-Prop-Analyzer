"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "./apiClient";
import { usePageVisible, useVisiblePolling, type PolledData } from "./hooks";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlayerInjury, BdlPlayerProp } from "@/lib/bdl/types";
import { appSettings } from "@/config/appSettings";
import { todayEastern } from "@/lib/dates";
import { isGameLive } from "@/lib/data/flatten";

export interface SlateData {
  date: string;
  games: BdlGame[];
  odds: BdlBettingOdd[];
  openingOdds: BdlBettingOdd[];
  injuries: BdlPlayerInjury[];
  notices: string[];
}

interface ListBody<ItemType> {
  data: ItemType[];
  unavailable?: boolean;
  reason?: string;
}

export async function loadSlate(slateDate: string): Promise<SlateData> {
  const [scheduleResult, oddsResult, openingResult, injuryResult] = await Promise.allSettled([
    fetchApi<{ games: BdlGame[] }>(`/api/schedule?date=${slateDate}`),
    fetchApi<ListBody<BdlBettingOdd>>(`/api/odds?date=${slateDate}`),
    fetchApi<ListBody<BdlBettingOdd>>(`/api/odds/opening?date=${slateDate}`),
    fetchApi<ListBody<BdlPlayerInjury>>(`/api/injuries`),
  ]);
  if (scheduleResult.status === "rejected") throw scheduleResult.reason;
  const notices: string[] = [];
  const listOrEmpty = <ItemType,>(settled: PromiseSettledResult<ListBody<ItemType>>, label: string): ItemType[] => {
    if (settled.status === "rejected") {
      notices.push(`${label} unavailable: ${settled.reason instanceof Error ? settled.reason.message : "error"}`);
      return [];
    }
    if (settled.value.unavailable) notices.push(`${label}: ${settled.value.reason ?? "unavailable on this tier"}`);
    return settled.value.data ?? [];
  };
  return {
    date: slateDate,
    games: [...scheduleResult.value.games].sort((first, second) => (first.datetime ?? "").localeCompare(second.datetime ?? "")),
    odds: listOrEmpty(oddsResult, "Live odds"),
    openingOdds: listOrEmpty(openingResult, "Opening odds"),
    injuries: listOrEmpty(injuryResult, "Injuries"),
    notices,
  };
}

export function useSlate(): PolledData<SlateData> {
  const slateDate = todayEastern();
  return useVisiblePolling(() => loadSlate(slateDate), appSettings.slatePollIntervalMs, slateDate); // every 10 min while visible
}

export async function loadProps(gameId: number, opening = false): Promise<BdlPlayerProp[]> {
  const body = await fetchApi<ListBody<BdlPlayerProp>>(`/api/props${opening ? "/opening" : ""}?game_id=${gameId}`);
  return body.data ?? [];
}

export function nextLiveDelay(games: BdlGame[], boxScores: BdlBoxScore[], nowMs = Date.now()): number | null {
  const anyLive = boxScores.some((boxScore) => isGameLive(boxScore)) || games.some((game) => isGameLive(game));
  if (anyLive) return appSettings.livePollIntervalMs;
  const upcomingTips = games
    .filter((game) => game.status_state === "scheduled" || (!game.status_state && !isGameLive(game)))
    .map((game) => Date.parse(game.datetime ?? ""))
    .filter((tipMs) => Number.isFinite(tipMs));
  const futureTips = upcomingTips.filter((tipMs) => tipMs > nowMs);
  if (upcomingTips.some((tipMs) => tipMs <= nowMs)) return appSettings.livePollIntervalMs; // tip time passed but status not updated yet
  if (futureTips.length === 0) return null; // nothing left today: sleep
  return Math.min(Math.max(Math.min(...futureTips) - nowMs, appSettings.livePollIntervalMs), 6 * 3_600_000); // sleep until the next tip-off
}

export interface LiveState {
  boxScores: BdlBoxScore[];
  lastUpdated: number | null;
  nextPollAt: number | null;
  error: string | null;
}

export function useLiveBoxScores(games: BdlGame[] | null): LiveState {
  const visible = usePageVisible();
  const [state, setState] = useState<LiveState>({ boxScores: [], lastUpdated: null, nextPollAt: null, error: null });
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const gamesKey = (games ?? []).map((game) => `${game.id}:${game.status}`).join("|");
  useEffect(() => {
    if (!visible || !games) return; // hidden: stop polling entirely
    let cancelled = false;
    let timer: number | undefined;
    let latestBoxes: BdlBoxScore[] = [];
    const schedule = (delayMs: number | null) => {
      setState((previous) => ({ ...previous, nextPollAt: delayMs === null ? null : Date.now() + delayMs }));
      if (delayMs !== null) timer = window.setTimeout(poll, delayMs);
    };
    const poll = async () => {
      try {
        const body = await fetchApi<{ data: BdlBoxScore[] }>("/api/live");
        latestBoxes = body.data ?? [];
        if (cancelled) return;
        setState((previous) => ({ ...previous, boxScores: latestBoxes, lastUpdated: Date.now(), error: null }));
      } catch (caughtError) {
        if (!cancelled) setState((previous) => ({ ...previous, error: caughtError instanceof Error ? caughtError.message : String(caughtError) }));
      }
      if (!cancelled) schedule(nextLiveDelay(gamesRef.current ?? [], latestBoxes));
    };
    const initialDelay = nextLiveDelay(games, []);
    if (initialDelay === appSettings.livePollIntervalMs) poll();
    else schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [visible, gamesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function matchBoxScore(game: BdlGame, boxScores: BdlBoxScore[]): BdlBoxScore | null {
  return boxScores.find((boxScore) => boxScore.home_team.team.id === game.home_team.id && boxScore.visitor_team.team.id === game.visitor_team.id && boxScore.date === game.date) ?? null; // live box scores carry no game id
}
