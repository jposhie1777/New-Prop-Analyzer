import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { BdlClient } from "../src/lib/bdl/bdlClient";
import type { BdlBettingOdd, BdlBoxScore, BdlGame, BdlPlay, BdlPlayerProp } from "../src/lib/bdl/types";
import { resolveTier, tierHasGoatEndpoints } from "../src/config/tiers";
import { appSettings } from "../src/config/appSettings";
import { addDays, todayEastern } from "../src/lib/dates";
import { isGameFinal, isGameLive } from "../src/lib/data/flatten";
import { normalizeBoxScores } from "../src/lib/bdl/normalize";
import { buildFinalsPayload } from "../src/lib/server/finalsBuilder";
import { emptyFinalsTables, type FinalsPayload } from "../src/lib/data/rowSchemas";
import { isBaselineManifest } from "../src/lib/data/manifest";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";
import { loadAnalyticsTables } from "../src/lib/analytics/loadTables";
import { quarterProfiles, type QuarterProfile } from "../src/lib/analytics/aggregates/playerAggregates";
import { buildLivePropRows } from "../src/lib/analytics/liveSuggestions";
import { parseGameClock, timeShares } from "../src/lib/analytics/liveProjection";
import { parseLivePlays, readLiveMarket } from "../src/lib/analytics/liveSignals";
import { checkpointFor, checkpointLabels, currentStat, gradeLiveBet, liveBetMinimumEvPercent, pickFromRow, selectCheckpointPicks, type LiveBetPick, type LiveNight } from "../src/lib/live/liveBets";
import { loadEnvironmentFiles } from "./loadEnvironment";

interface TrackerOptions {
  dataDirectory: string;
  once: boolean;
  useGit: boolean;
  maxMinutes: number;
  intervalSeconds: number;
}

const cachedTables = ["games", "players", "player_game_stats", "player_period_stats"] as const; // all the live model needs from finished games

function parseOptions(argumentList: string[]): TrackerOptions {
  const options: TrackerOptions = { dataDirectory: "live-data", once: false, useGit: false, maxMinutes: 345, intervalSeconds: 60 };
  for (let argumentIndex = 0; argumentIndex < argumentList.length; argumentIndex++) {
    const flag = argumentList[argumentIndex];
    if (flag === "--data-dir") options.dataDirectory = argumentList[++argumentIndex];
    else if (flag === "--once") options.once = true; // one pass, for testing
    else if (flag === "--git") options.useGit = true; // commit and push the data branch
    else if (flag === "--max-minutes") options.maxMinutes = Number(argumentList[++argumentIndex]);
    else if (flag === "--interval-seconds") options.intervalSeconds = Number(argumentList[++argumentIndex]);
  }
  return options;
}

function readJson<ValueType>(filePath: string, fallback: ValueType): ValueType {
  try {
    return existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf8")) as ValueType) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(`${filePath}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${filePath}.tmp`, filePath);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function commitData(options: TrackerOptions, message: string): void {
  if (!options.useGit) return;
  const git = (...gitArguments: string[]) => execFileSync("git", ["-C", options.dataDirectory, ...gitArguments], { stdio: "pipe" }).toString();
  try {
    git("add", "-A");
    try {
      git("diff", "--cached", "--quiet");
      return; // nothing changed
    } catch {
      // there are staged changes
    }
    git("commit", "-m", message);
    try {
      git("push", "origin", "HEAD:live-data");
    } catch {
      git("pull", "--rebase", "origin", "live-data");
      git("push", "origin", "HEAD:live-data");
    }
  } catch (caughtError) {
    log(`git save failed: ${caughtError instanceof Error ? caughtError.message.split("\n")[0] : "error"}`);
  }
}

async function finishedDatesAfter(client: BdlClient, season: number, afterDate: string, throughDate: string): Promise<string[]> {
  if (afterDate >= throughDate) return [];
  const games = await client.getAllPages<BdlGame>("/nba/v1/games", { "seasons[]": [season], start_date: addDays(afterDate, 1), end_date: throughDate });
  return [...new Set(games.filter(isGameFinal).map((game) => game.date.slice(0, 10)))].sort();
}

async function loadFinishedGames(client: BdlClient, options: TrackerOptions, today: string): Promise<NodeAnalyticsEngine> {
  const baselineDirectory = resolve("public", "data", client.tier === "mock" ? "mock-baseline" : "baseline");
  const rawManifest: unknown = readJson(join(baselineDirectory, "manifest.json"), null);
  const manifest = isBaselineManifest(rawManifest) ? rawManifest : null;
  const cacheDirectory = join(options.dataDirectory, "finals");
  mkdirSync(cacheDirectory, { recursive: true });
  const dates = await finishedDatesAfter(client, appSettings.currentSeason, manifest?.lastDate ?? addDays(today, -30), addDays(today, -1));
  const payloads: FinalsPayload[] = [];
  for (const isoDate of dates) {
    const cachePath = join(cacheDirectory, `${isoDate}.json.gz`);
    if (existsSync(cachePath)) {
      payloads.push(JSON.parse(gunzipSync(readFileSync(cachePath)).toString()) as FinalsPayload);
      continue;
    }
    const fullPayload = await buildFinalsPayload(client, isoDate); // once per date, then cached on the data branch
    const compactTables = emptyFinalsTables();
    for (const tableName of cachedTables) compactTables[tableName] = fullPayload.tables[tableName];
    const compact: FinalsPayload = { ...fullPayload, tables: compactTables };
    if (fullPayload.complete) writeFileSync(cachePath, gzipSync(JSON.stringify(compact)));
    payloads.push(compact);
    log(`cached finals for ${isoDate} (${fullPayload.bdlCalls} calls)`);
  }
  const engine = await NodeAnalyticsEngine.create();
  await loadAnalyticsTables(engine, { manifest, baselineBaseUrl: baselineDirectory, topUpPayloads: payloads });
  log(`stats loaded: baseline through ${manifest?.lastDate ?? "none"} + ${payloads.length} cached day(s)`);
  return engine;
}

function matchupOf(game: BdlGame): string {
  return `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`;
}

function boxScoreForGame(game: BdlGame, boxScores: BdlBoxScore[]): BdlBoxScore | null {
  return boxScores.find((boxScore) => boxScore.home_team.team.id === game.home_team.id && boxScore.visitor_team.team.id === game.visitor_team.id) ?? null;
}

function mergeHistory(options: TrackerOptions, gradedPicks: LiveBetPick[]): void {
  const historyPath = join(options.dataDirectory, "live", "history.json");
  const history = readJson<LiveBetPick[]>(historyPath, []);
  const byId = new Map(history.map((pick) => [pick.pickId, pick]));
  for (const pick of gradedPicks) byId.set(pick.pickId, pick);
  writeJson(historyPath, [...byId.values()].sort((first, second) => first.foundAt.localeCompare(second.foundAt)));
}

async function gradeNight(client: BdlClient, night: LiveNight, gameIds: Set<number>): Promise<boolean> {
  const pending = night.picks.filter((pick) => !pick.result && gameIds.has(pick.gameId));
  if (pending.length === 0) return false;
  const finals = normalizeBoxScores((await client.get<{ data: unknown }>("/nba/v1/box_scores", { date: night.date })).data);
  const nowIso = new Date().toISOString();
  let changed = false;
  night.picks = night.picks.map((pick) => {
    if (pick.result || !gameIds.has(pick.gameId)) return pick;
    const finalBox = finals.find((boxScore) => isGameFinal(boxScore) && night.games.some((game) => game.gameId === pick.gameId && game.matchup === `${boxScore.visitor_team.team.abbreviation} @ ${boxScore.home_team.team.abbreviation}`));
    if (!finalBox) return pick;
    changed = true;
    return gradeLiveBet(pick, finalBox, nowIso);
  });
  return changed;
}

async function gradeEarlierNights(client: BdlClient, options: TrackerOptions, today: string): Promise<void> {
  for (let daysBack = 1; daysBack <= 3; daysBack++) {
    const isoDate = addDays(today, -daysBack);
    const nightPath = join(options.dataDirectory, "live", `${isoDate}.json`);
    const night = readJson<LiveNight | null>(nightPath, null);
    if (!night || night.picks.every((pick) => pick.result)) continue;
    const changed = await gradeNight(client, night, new Set(night.games.map((game) => game.gameId))); // a run that stopped early is finished here
    if (!changed) continue;
    night.state = "done";
    night.updatedAt = new Date().toISOString();
    writeJson(nightPath, night);
    mergeHistory(options, night.picks.filter((pick) => pick.result));
    log(`graded leftover picks from ${isoDate}`);
  }
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const options = parseOptions(process.argv.slice(2));
  const tier = resolveTier(process.env.BDL_TIER);
  if (!tierHasGoatEndpoints(tier)) throw new Error("Live props need the GOAT tier.");
  const client = new BdlClient({ tier, apiKey: process.env.BDL_API_KEY });
  const startedMs = Date.now();
  const deadlineMs = startedMs + options.maxMinutes * 60_000;
  const today = todayEastern(Date.now() - 6 * 3_600_000); // the slate rolls over at 6 AM Eastern, so a run after midnight keeps last night's late games
  const nightPath = join(options.dataDirectory, "live", `${today}.json`);
  const statusPath = join(options.dataDirectory, "live", "status.json");
  const night: LiveNight = readJson<LiveNight>(nightPath, { date: today, updatedAt: new Date().toISOString(), state: "waiting", games: [], picks: [], calls: 0, note: null });
  const saveNight = (state: LiveNight["state"], note: string | null) => {
    night.state = state;
    night.note = note;
    night.updatedAt = new Date().toISOString();
    night.calls = client.callCount;
    writeJson(nightPath, night);
    writeJson(statusPath, { date: today, state, updatedAt: night.updatedAt, picks: night.picks.length, liveGames: night.games.filter((game) => /qtr|half|ot/i.test(game.status)).length, note });
  };

  await gradeEarlierNights(client, options, today);
  const schedule = await client.getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [today] });
  night.games = schedule.map((game) => ({ gameId: game.id, matchup: matchupOf(game), status: game.status ?? "", homeScore: game.home_team_score, visitorScore: game.visitor_team_score }));
  if (schedule.length === 0) {
    saveNight("done", "No games today.");
    commitData(options, `live ${today}: no games [skip ci]`);
    return;
  }
  if (schedule.every(isGameFinal) && night.picks.every((pick) => pick.result)) {
    saveNight("done", "All games are final.");
    commitData(options, `live ${today}: done [skip ci]`);
    return;
  }
  const firstTipMs = Math.min(...schedule.filter((game) => !isGameFinal(game)).map((game) => Date.parse(game.datetime ?? "") || Date.now()));
  if (!options.once && firstTipMs - 10 * 60_000 > deadlineMs - 60 * 60_000) {
    log("first tip-off is too late for this run; a later scheduled run takes it");
    return;
  }
  const status = readJson<{ state?: string; updatedAt?: string; date?: string }>(statusPath, {});
  if (!options.once && status.date === today && status.state === "running" && Date.now() - Date.parse(status.updatedAt ?? "") < 4 * 60_000) {
    log("another run is already tracking tonight");
    return;
  }
  while (!options.once && Date.now() < firstTipMs - 10 * 60_000) {
    saveNight("waiting", `First tip-off ${new Date(firstTipMs).toISOString()}`);
    commitData(options, `live ${today}: waiting [skip ci]`);
    await sleep(Math.min(15 * 60_000, firstTipMs - 10 * 60_000 - Date.now()));
  }

  const engine = await loadFinishedGames(client, options, today);
  const openingProps = new Map<number, BdlPlayerProp[]>();
  const profilesByGame = new Map<number, Map<number, QuarterProfile>>();
  const gradedGames = new Set<number>();
  let openingOdds: BdlBettingOdd[] | null = null;
  let lastCommitMs = 0;
  let changedSinceCommit = true;
  try {
    for (;;) {
      const loopStartedMs = Date.now();
      const nowIso = new Date().toISOString();
      const scheduleNow = await client.getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [today] });
      const liveBoxes = normalizeBoxScores((await client.get<{ data: unknown }>("/nba/v1/box_scores/live", {})).data);
      for (const game of scheduleNow) {
        const boxScore = boxScoreForGame(game, liveBoxes);
        const summary = night.games.find((entry) => entry.gameId === game.id);
        if (summary) Object.assign(summary, { status: boxScore?.status ?? game.status ?? "", homeScore: boxScore?.home_team_score ?? game.home_team_score, visitorScore: boxScore?.visitor_team_score ?? game.visitor_team_score });
        if (!boxScore || !isGameLive(boxScore)) continue;
        for (const pick of night.picks.filter((candidate) => candidate.gameId === game.id && !candidate.result)) {
          const latest = currentStat(boxScore, pick);
          if (latest !== null && latest !== pick.latestValue) {
            pick.latestValue = latest;
            changedSinceCommit = true;
          }
        }
        const clock = parseGameClock(boxScore.status, boxScore.time, boxScore.period);
        const checkpoint = checkpointFor(clock);
        const taken = (night.checkpointsTaken ??= {})[String(game.id)] ?? [];
        if (!checkpoint || taken.includes(checkpoint)) continue; // props are only read at the breaks, which also saves calls
        openingOdds ??= await client.getAllPages<BdlBettingOdd>("/nba/v2/odds/opening", { "dates[]": [today] }).catch(() => []);
        if (!openingProps.has(game.id)) openingProps.set(game.id, (await client.get<{ data: BdlPlayerProp[] }>("/nba/v2/odds/player_props/opening", { game_id: game.id }).catch(() => ({ data: [] }))).data ?? []);
        const boxPlayers = [...boxScore.home_team.players, ...boxScore.visitor_team.players];
        if (!profilesByGame.has(game.id)) profilesByGame.set(game.id, await quarterProfiles(engine, boxPlayers.map((boxPlayer) => boxPlayer.player.id), 10));
        const liveOdds = await client.getAllPages<BdlBettingOdd>("/nba/v2/odds", { "dates[]": [today] });
        const props = (await client.get<{ data: BdlPlayerProp[] }>("/nba/v2/odds/player_props", { game_id: game.id })).data ?? [];
        if (props.length === 0) continue; // books can pull props during a break: try again next check while it is still the break
        const plays = (await client.get<{ data: BdlPlay[] }>("/nba/v1/plays", { game_id: game.id }).catch(() => ({ data: [] as BdlPlay[] }))).data ?? [];
        const activity = plays.length > 0 ? parseLivePlays(plays, boxPlayers.map((boxPlayer) => ({ id: boxPlayer.player.id, name: `${boxPlayer.player.first_name} ${boxPlayer.player.last_name}` }))) : null;
        const market = readLiveMarket(liveOdds.filter((bettingOdd) => bettingOdd.game_id === game.id), openingOdds.filter((bettingOdd) => bettingOdd.game_id === game.id), boxScore.home_team_score + boxScore.visitor_team_score, timeShares(clock, { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 }).remainingClock, game.datetime);
        const { rows } = buildLivePropRows(boxScore, props, openingProps.get(game.id) ?? [], profilesByGame.get(game.id)!, liveBetMinimumEvPercent, { activity, shotProfiles: null, market });
        const candidates = rows.map((row) => pickFromRow(row, boxScore, game.id, today, clock, nowIso)).filter((pick): pick is LiveBetPick => pick !== null);
        const chosen = selectCheckpointPicks(candidates, checkpoint, new Set(night.picks.map((pick) => pick.pickId)));
        night.picks.push(...chosen);
        night.checkpointsTaken[String(game.id)] = [...taken, checkpoint];
        changedSinceCommit = true;
        log(`${matchupOf(game)} ${checkpointLabels[checkpoint]}: ${chosen.length} picks from ${candidates.length} edges`);
        for (const pick of chosen) log(`  ${pick.playerName} ${pick.side} ${pick.line} ${pick.label} ${pick.americanOdds} (${pick.vendor}) ${pick.evPercent.toFixed(1)}% EV`);
      }
      const newlyFinal = new Set(scheduleNow.filter((game) => isGameFinal(game) && !gradedGames.has(game.id)).map((game) => game.id));
      if (newlyFinal.size > 0 && (await gradeNight(client, night, newlyFinal))) changedSinceCommit = true;
      newlyFinal.forEach((gameId) => {
        if (!night.picks.some((pick) => pick.gameId === gameId && !pick.result)) gradedGames.add(gameId);
      });
      const allDone = scheduleNow.every(isGameFinal) && night.picks.every((pick) => pick.result);
      const outOfTime = Date.now() + options.intervalSeconds * 1000 > deadlineMs;
      if (allDone || outOfTime || options.once) {
        saveNight(allDone ? "done" : "running", allDone ? "All games are final and graded." : outOfTime ? "This run hit its time limit; the next scheduled run continues." : null);
        mergeHistory(options, night.picks.filter((pick) => pick.result));
        commitData(options, `live ${today}: ${night.picks.length} picks, ${night.picks.filter((pick) => pick.result).length} graded [skip ci]`);
        log(`stopping: ${allDone ? "all games final" : outOfTime ? "time limit" : "single pass"} | ${night.picks.length} picks | ${client.callCount} BDL calls`);
        break;
      }
      saveNight("running", null);
      if (changedSinceCommit && Date.now() - lastCommitMs > 3 * 60_000) {
        commitData(options, `live ${today}: ${night.picks.length} picks [skip ci]`);
        lastCommitMs = Date.now();
        changedSinceCommit = false;
      }
      await sleep(Math.max(5_000, options.intervalSeconds * 1000 - (Date.now() - loopStartedMs)));
    }
  } finally {
    engine.close();
  }
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
