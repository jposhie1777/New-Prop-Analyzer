"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "./apiClient";
import { usePageVisible, useVisiblePolling, type PolledData } from "./hooks";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlayerInjury, BdlPlayerProp } from "@/lib/bdl/types";
import { appSettings } from "@/config/appSettings";
import { todayEastern } from "@/lib/dates";
import { isGameLive } from "@/lib/data/flatten";
import { booksKey, filterByBooks, rememberSeenBooks } from "./bookFilter";
import { useSettings } from "./hooks";

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

export async function loadSlate(slateDate: string, enabledBooks: string[] = []): Promise<SlateData> {
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
    odds: booksOnly(listOrEmpty(oddsResult, "Live odds"), enabledBooks),
    openingOdds: booksOnly(listOrEmpty(openingResult, "Opening odds"), enabledBooks),
    injuries: listOrEmpty(injuryResult, "Injuries"),
    notices,
  };
}

function booksOnly<ItemType extends { vendor: string }>(items: ItemType[], enabledBooks: string[]): ItemType[] {
  rememberSeenBooks([...new Set(items.map((item) => item.vendor))]);
  return filterByBooks(items, enabledBooks); // only the sportsbooks chosen in Settings
}

export function useSlate(): PolledData<SlateData> {
  const slateDate = todayEastern();
  const { enabledBooks } = useSettings();
  return useVisiblePolling(() => loadSlate(slateDate, enabledBooks), appSettings.slatePollIntervalMs, `${slateDate}:${booksKey(enabledBooks)}`); // every 10 min while visible
}

export function useLiveOdds(slateDate: string, anyLive: boolean): PolledData<BdlBettingOdd[]> {
  return useVisiblePolling(anyLive ? async () => (await fetchApi<ListBody<BdlBettingOdd>>(`/api/odds?date=${slateDate}`)).data ?? [] : null, 60_000, `live-odds:${slateDate}:${anyLive}`); // every book, every minute while a game is live
}

export async function loadProps(gameId: number, opening = false, enabledBooks: string[] = []): Promise<BdlPlayerProp[]> {
  const body = await fetchApi<ListBody<BdlPlayerProp>>(`/api/props${opening ? "/opening" : ""}?game_id=${gameId}`);
  return booksOnly(body.data ?? [], enabledBooks);
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
  return boxScores.find((boxScore) => boxScore.home_team?.team?.id === game.home_team.id && boxScore.visitor_team?.team?.id === game.visitor_team.id && (!boxScore.date || boxScore.date === game.date)) ?? null; // live box scores carry no game id
}
