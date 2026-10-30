"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "./apiClient";
import { loadAppConfig } from "./appConfig";
import { useSettings, useVisiblePolling, type PolledData } from "./hooks";
import { filterByBooks, rememberSeenBooks } from "./bookFilter";
import { buildGamePick, type GameSelection } from "./pickBuilders";
import type { SlipPick } from "./betSlip";
import type { BdlBettingOdd, BdlGame } from "@/lib/bdl/types";
import { summarizeRecord } from "@/lib/tracking/tracker";
import { analyzeNcaabGame, type NcaabGameAnalysis } from "@/lib/ncaab/lines";
import { isNcaabFinal, isNcaabLive, ncaabGameDate, type NcaabGame } from "@/lib/ncaab/types";
import type { BoxFile, OddsFile, RatedTeam, RatingsFile, RecordFile, TeamFile } from "@/lib/ncaab/dataFiles";

const fileCache = new Map<string, { loadedAt: number; promise: Promise<unknown> }>();
const fileMaxAgeMs = 5 * 60_000; // the data branches change at most a few times a day

async function loadNcaabFile<FileType>(branch: "data" | "odds", path: string): Promise<FileType | null> {
  const config = await loadAppConfig();
  const url = `${branch === "data" ? config.ncaabDataBase : config.ncaabOddsBase}/${path}`;
  const cached = fileCache.get(url);
  if (cached && Date.now() - cached.loadedAt < fileMaxAgeMs) return cached.promise as Promise<FileType | null>;
  const promise = fetch(url, { cache: "no-cache" }).then((response) => (response.ok ? (response.json() as Promise<FileType>) : null)); // a missing file (no odds yet) is normal
  fileCache.set(url, { loadedAt: Date.now(), promise });
  promise.catch(() => fileCache.delete(url));
  return promise;
}

export function useNcaabFile<FileType>(branch: "data" | "odds", path: string | null): { data: FileType | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: FileType | null; loading: boolean; error: string | null }>({ data: null, loading: Boolean(path), error: null });
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    loadNcaabFile<FileType>(branch, path).then(
      (data) => !cancelled && setState({ data, loading: false, error: null }),
      (caughtError) => !cancelled && setState({ data: null, loading: false, error: caughtError instanceof Error ? caughtError.message : String(caughtError) }),
    );
    return () => {
      cancelled = true;
    };
  }, [branch, path]);
  return state;
}

export function useNcaabRatings() {
  return useNcaabFile<RatingsFile>("data", "ratings.json");
}

export function useNcaabTeamFile(teamId: number | null) {
  return useNcaabFile<TeamFile>("data", teamId === null ? null : `teams/${teamId}.json`);
}

export function useNcaabBox(gameId: number | null) {
  return useNcaabFile<BoxFile>("data", gameId === null ? null : `boxes/${gameId}.json`);
}

export function useNcaabRecord() {
  return useNcaabFile<RecordFile>("data", "record.json");
}

export async function loadNcaabGames(isoDate: string): Promise<NcaabGame[]> {
  const body = await fetchApi<{ games: NcaabGame[] }>(`/api/ncaab/games?date=${isoDate}`);
  return [...body.games].sort((first, second) => first.date.localeCompare(second.date));
}

export function useNcaabGames(isoDate: string): PolledData<NcaabGame[]> {
  const [anyLive, setAnyLive] = useState(false);
  const polled = useVisiblePolling(() => loadNcaabGames(isoDate), anyLive ? 60_000 : 600_000, isoDate); // every minute while games are on, else every 10
  const liveNow = (polled.data ?? []).some(isNcaabLive);
  useEffect(() => setAnyLive(liveNow), [liveNow]);
  return polled;
}

export interface NcaabSlateGame {
  game: NcaabGame;
  home: RatedTeam | null;
  away: RatedTeam | null;
  odds: BdlBettingOdd[];
  analysis: NcaabGameAnalysis | null; // null once the game has started, or without ratings or odds
}

export interface NcaabSlate {
  games: NcaabSlateGame[];
  ratings: RatingsFile | null;
  oddsFile: OddsFile | null;
  loading: boolean;
  error: string | null;
}

export function useNcaabSlate(isoDate: string): NcaabSlate {
  const settings = useSettings();
  const gamesPolled = useNcaabGames(isoDate);
  const ratings = useNcaabRatings();
  const record = useNcaabRecord();
  const odds = useNcaabFile<OddsFile>("odds", `odds/${isoDate}.json`);
  const ratingsById = new Map((ratings.data?.teams ?? []).map((team) => [team.id, team]));
  const marketRecords = new Map(["spread", "total", "moneyline"].map((market) => {
    const summary = summarizeRecord((record.data?.picks ?? []).filter((pick) => pick.kind === market));
    return [market, { decided: summary.wins + summary.losses, roiPercent: summary.roiPercent }];
  }));
  const allOdds = Object.values(odds.data?.current ?? {}).flat();
  useEffect(() => rememberSeenBooks([...new Set(allOdds.map((bettingOdd) => bettingOdd.vendor))]), [allOdds.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const games = (gamesPolled.data ?? []).map((game): NcaabSlateGame => {
    const home = ratingsById.get(game.home_team.id) ?? null;
    const away = ratingsById.get(game.visitor_team.id) ?? null;
    const gameOdds = filterByBooks(odds.data?.current[game.id] ?? [], settings.enabledBooks);
    const started = isNcaabFinal(game) || isNcaabLive(game) || new Date(game.date).getTime() <= Date.now();
    const analysis = !started && home && away && ratings.data && gameOdds.length > 0 ? analyzeNcaabGame({ game, home, away, league: ratings.data.league, odds: gameOdds, openingOdds: filterByBooks(odds.data?.opening[game.id] ?? [], settings.enabledBooks), evThresholdPercent: settings.evThresholdPercent, marketRecords }) : null;
    return { game, home, away, odds: gameOdds, analysis };
  });
  return { games, ratings: ratings.data, oddsFile: odds.data, loading: gamesPolled.loading || ratings.loading, error: gamesPolled.error ?? ratings.error };
}

export function teamLabel(team: { college: string; abbreviation: string }): string {
  return team.abbreviation || team.college;
}

export function buildNcaabGamePick(game: NcaabGame, odds: BdlBettingOdd[], selection: GameSelection, source: string): Omit<SlipPick, "addedAt"> | null {
  const home = { abbreviation: teamLabel(game.home_team) };
  const away = { abbreviation: teamLabel(game.visitor_team) };
  const pick = buildGamePick({ id: game.id, date: ncaabGameDate(game), home_team: home, visitor_team: away }, odds, selection, source);
  if (!pick) return null;
  return { ...pick, pickId: `ncaab-${pick.pickId}`, detail: `NCAAB · ${game.visitor_team.college} @ ${game.home_team.college}`, sport: "ncaab" }; // college ids can repeat NBA ids, so the slip keeps them apart
}

export function ncaabAsBdlGame(game: NcaabGame): BdlGame {
  return {
    id: game.id,
    date: ncaabGameDate(game),
    season: game.season,
    status: game.status,
    status_state: (game.status_state ?? undefined) as BdlGame["status_state"],
    period: game.period,
    time: game.period_detail ?? null,
    datetime: game.date,
    postseason: game.postseason,
    home_team_score: game.home_score ?? 0,
    visitor_team_score: game.away_score ?? 0,
    home_team: { id: game.home_team.id, abbreviation: teamLabel(game.home_team), city: game.home_team.college, name: game.home_team.name, full_name: game.home_team.full_name, conference: "", division: "" },
    visitor_team: { id: game.visitor_team.id, abbreviation: teamLabel(game.visitor_team), city: game.visitor_team.college, name: game.visitor_team.name, full_name: game.visitor_team.full_name, conference: "", division: "" },
  } as BdlGame; // just enough for bet tracking, which reads scores and status
}

export function useNcaabGamesForDates(dates: string[]): NcaabGame[] {
  const [games, setGames] = useState<NcaabGame[]>([]);
  const key = [...new Set(dates)].sort().join(",");
  const visibleTick = useVisiblePolling(key ? () => Promise.all(key.split(",").map((isoDate) => loadNcaabGames(isoDate).catch(() => []))).then((lists) => lists.flat()) : null, 60_000, key);
  useEffect(() => setGames(visibleTick.data ?? []), [visibleTick.data]);
  return games;
}
