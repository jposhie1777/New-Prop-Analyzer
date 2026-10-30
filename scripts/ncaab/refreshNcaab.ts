import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { BdlClient } from "../../src/lib/bdl/bdlClient";
import { todayEastern } from "../../src/lib/dates";
import { buildGameBox, normalizeName, type GameBox } from "../../src/lib/ncaab/boxScore";
import { adjustedRatings, blendRatings, leagueAverages, returningShares } from "../../src/lib/ncaab/ratings";
import { isNcaabFinal, ncaabGameDate, ncaabSeasonFor, type NcaabConference, type NcaabGame, type NcaabPlay, type NcaabPlayer, type NcaabRanking, type NcaabTeam } from "../../src/lib/ncaab/types";
import { playerAverages, type BoxFile, type MetaFile, type PicksFile, type RatingsFile, type RecordFile, type TeamFile, type TeamGameLog } from "../../src/lib/ncaab/dataFiles";
import { ncaabTier } from "../../src/lib/ncaab/ncaabTier";
import { gradePick, type TrackedPick } from "../../src/lib/tracking/tracker";
import { loadEnvironmentFiles } from "../loadEnvironment";

interface RefreshOptions {
  outputDirectory: string;
  oddsDirectory: string | null; // a checkout of the ncaab-odds branch, for grading picks
  budgetMinutes: number; // play-by-play backfill stops after this long and picks up the next night
}

function parseOptions(argumentList: string[]): RefreshOptions {
  const options: RefreshOptions = { outputDirectory: "ncaab-data", oddsDirectory: null, budgetMinutes: 300 };
  for (let argumentIndex = 0; argumentIndex < argumentList.length; argumentIndex++) {
    const flag = argumentList[argumentIndex];
    if (flag === "--out") options.outputDirectory = argumentList[++argumentIndex];
    else if (flag === "--odds") options.oddsDirectory = argumentList[++argumentIndex];
    else if (flag === "--budget-minutes") options.budgetMinutes = Number(argumentList[++argumentIndex]);
  }
  return options;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function readJson<ResultType>(filePath: string): ResultType | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as ResultType;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value));
}

const cacheFolder = "cache";

function loadBoxCache(outputDirectory: string): { boxes: Map<number, GameBox>; failures: Map<number, number> } {
  const boxes = new Map<number, GameBox>();
  const directory = join(outputDirectory, cacheFolder);
  if (existsSync(directory)) {
    for (const fileName of readdirSync(directory).filter((name) => name.startsWith("boxes-") && name.endsWith(".json.gz"))) {
      const monthBoxes = JSON.parse(gunzipSync(readFileSync(join(directory, fileName))).toString("utf8")) as GameBox[];
      for (const box of monthBoxes) boxes.set(box.gameId, box);
    }
  }
  const failures = new Map(Object.entries(readJson<Record<string, number>>(join(directory, "failures.json")) ?? {}).map(([gameId, attempts]) => [Number(gameId), attempts]));
  return { boxes, failures };
}

function saveBoxCache(outputDirectory: string, boxes: Map<number, GameBox>, failures: Map<number, number>): void {
  const directory = join(outputDirectory, cacheFolder);
  mkdirSync(directory, { recursive: true });
  const byMonth = new Map<string, GameBox[]>();
  for (const box of boxes.values()) {
    const monthBoxes = byMonth.get(box.date.slice(0, 7)) ?? [];
    monthBoxes.push(box);
    byMonth.set(box.date.slice(0, 7), monthBoxes);
  }
  for (const [month, monthBoxes] of byMonth) writeFileSync(join(directory, `boxes-${month}.json.gz`), gzipSync(JSON.stringify(monthBoxes))); // one file per month keeps each under GitHub's size limits
  writeJson(join(directory, "failures.json"), Object.fromEntries(failures));
}

function pickAp(rankings: NcaabRanking[]): NcaabRanking[] {
  const pollOf = (ranking: NcaabRanking) => String(ranking.poll_id ?? ranking.poll ?? "");
  const polls = [...new Set(rankings.map(pollOf))];
  const apPoll = polls.find((poll) => /\bap\b|associated/i.test(poll)) ?? polls[0]; // the AP poll, else whichever poll the API lists first
  const inPoll = rankings.filter((ranking) => pollOf(ranking) === apPoll);
  const latestWeek = Math.max(...inPoll.map((ranking) => ranking.week));
  return inPoll.filter((ranking) => ranking.week === latestWeek && ranking.rank <= 25);
}

function gradePicks(picks: TrackedPick[], gamesById: Map<number, NcaabGame>, gradedAt: string): TrackedPick[] {
  return picks.map((pick) => {
    if (pick.result) return pick;
    const game = gamesById.get(pick.gameId);
    if (!game) return pick;
    if (game.status_state === "canceled" || game.status_state === "abandoned") return { ...pick, result: { status: "void", actual: null, gradedAt } };
    if (!isNcaabFinal(game) || game.home_score === null || game.away_score === null) return pick;
    const actual = pick.kind === "total" ? game.home_score + game.away_score : game.home_score - game.away_score; // home margin for spreads and moneylines
    return { ...pick, result: { status: gradePick(pick, { actual }), actual, gradedAt } };
  });
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const options = parseOptions(process.argv.slice(2));
  const startedAt = Date.now();
  const deadline = startedAt + options.budgetMinutes * 60_000;
  const client = new BdlClient({ tier: ncaabTier(), apiKey: process.env.BDL_API_KEY });
  const today = todayEastern();
  const season = ncaabSeasonFor(today);
  const lastSeason = season - 1;
  mkdirSync(options.outputDirectory, { recursive: true });
  log(`NCAAB refresh for the ${season}-${String(season + 1).slice(2)} season (tier ${client.tier})`);

  const teams = await client.getAllPages<NcaabTeam>("/ncaab/v1/teams");
  const conferences = (await client.get<{ data: NcaabConference[] }>("/ncaab/v1/conferences")).data;
  const activePlayers = await client.getAllPages<NcaabPlayer>("/ncaab/v1/players/active");
  log(`${teams.length} teams, ${conferences.length} conferences, ${activePlayers.length} active players`);

  const rosterIds = new Map<string, number>(); // "teamId|name" and, when unique, "name" to player id
  const nameCounts = new Map<string, number>();
  const currentRoster = new Map<number, number>(); // player id to current team id
  for (const player of activePlayers) {
    const nameKey = normalizeName(`${player.first_name} ${player.last_name}`);
    if (player.team) {
      rosterIds.set(`${player.team.id}|${nameKey}`, player.id);
      currentRoster.set(player.id, player.team.id);
    }
    nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
    rosterIds.set(nameKey, player.id);
  }
  for (const [nameKey, count] of nameCounts) if (count > 1) rosterIds.delete(nameKey); // a shared name could be the wrong player

  const games = [...(await client.getAllPages<NcaabGame>("/ncaab/v1/games", { "seasons[]": [season] })), ...(await client.getAllPages<NcaabGame>("/ncaab/v1/games", { "seasons[]": [lastSeason] }))];
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const finals = games.filter((game) => isNcaabFinal(game) && game.home_score !== null && game.away_score !== null);
  log(`${games.length} games, ${finals.length} final`);

  const { boxes, failures } = loadBoxCache(options.outputDirectory);
  const missing = finals
    .filter((game) => !boxes.has(game.id) && (failures.get(game.id) ?? 0) < 3)
    .sort((first, second) => (first.season !== second.season ? second.season - first.season : ncaabGameDate(second).localeCompare(ncaabGameDate(first)))); // this season first, newest first
  log(`${boxes.size} box scores cached, ${missing.length} to rebuild`);
  let rebuiltCount = 0;
  for (const game of missing) {
    if (Date.now() > deadline) break;
    try {
      const plays = await client.getAllPages<NcaabPlay>("/ncaab/v1/plays", { game_id: game.id });
      if (plays.length < 20) failures.set(game.id, (failures.get(game.id) ?? 0) + 1); // no play-by-play yet; try again another night
      else boxes.set(game.id, buildGameBox(game, plays, rosterIds));
    } catch (caughtError) {
      failures.set(game.id, (failures.get(game.id) ?? 0) + 1);
      log(`plays failed for game ${game.id}: ${caughtError instanceof Error ? caughtError.message : caughtError}`);
    }
    rebuiltCount += 1;
    if (rebuiltCount % 250 === 0) {
      saveBoxCache(options.outputDirectory, boxes, failures); // save as we go so a timeout keeps the work
      log(`rebuilt ${rebuiltCount}/${missing.length}`);
    }
  }
  saveBoxCache(options.outputDirectory, boxes, failures);

  for (const box of boxes.values()) for (const line of box.players) if (line.playerId === null) line.playerId = rosterIds.get(`${line.teamId}|${normalizeName(line.name)}`) ?? rosterIds.get(normalizeName(line.name)) ?? null; // rosters fill in over the season
  const seasonBoxes = [...boxes.values()].filter((box) => box.season === season);
  const lastSeasonBoxes = [...boxes.values()].filter((box) => box.season === lastSeason);
  const league = leagueAverages(seasonBoxes.filter((box) => box.quality.pointsMatch));
  const lastLeague = leagueAverages(lastSeasonBoxes.filter((box) => box.quality.pointsMatch));
  const seasonLeague = seasonBoxes.length >= 200 ? league : lastLeague; // early in the season, last year's scoring level is steadier
  const seasonRatings = adjustedRatings(seasonBoxes, seasonLeague);
  const lastRatings = adjustedRatings(lastSeasonBoxes, lastLeague);
  const shares = returningShares(lastSeasonBoxes.flatMap((box) => box.players), currentRoster);
  const teamIds = [...new Set([...teams.map((team) => team.id), ...games.filter((game) => game.season === season).flatMap((game) => [game.home_team.id, game.visitor_team.id])])];
  const blended = blendRatings(seasonRatings, lastRatings, seasonLeague, lastLeague, shares, teamIds);

  let rankings: NcaabRanking[] = [];
  try {
    rankings = pickAp(await client.getAllPages<NcaabRanking>("/ncaab/v1/rankings", { season }));
  } catch (caughtError) {
    log(`rankings unavailable: ${caughtError instanceof Error ? caughtError.message : caughtError}`);
  }
  const rankByTeam = new Map(rankings.map((ranking) => [ranking.team.id, ranking.rank]));
  const conferenceNames = new Map(conferences.map((conference) => [conference.id, conference.short_name ?? conference.name]));
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  for (const game of games) for (const team of [game.home_team, game.visitor_team]) if (!teamsById.has(team.id)) teamsById.set(team.id, team);

  const record = new Map<number, { wins: number; losses: number }>();
  for (const game of finals.filter((candidate) => candidate.season === season)) {
    const homeWon = game.home_score! > game.away_score!;
    for (const [teamId, won] of [[game.home_team.id, homeWon], [game.visitor_team.id, !homeWon]] as Array<[number, boolean]>) {
      const teamRecord = record.get(teamId) ?? { wins: 0, losses: 0 };
      if (won) teamRecord.wins += 1;
      else teamRecord.losses += 1;
      record.set(teamId, teamRecord);
    }
  }

  const generatedAt = new Date().toISOString();
  const ratingsFile: RatingsFile = {
    generatedAt,
    season,
    lastSeason,
    league: seasonLeague,
    lastLeague,
    rankingsWeek: rankings[0]?.week ?? null,
    rankingsSeason: rankings[0]?.season ?? null,
    teams: [...blended.values()]
      .filter((rating) => teamsById.has(rating.teamId))
      .map((rating) => {
        const team = teamsById.get(rating.teamId)!;
        return { id: team.id, college: team.college, name: team.name, abbreviation: team.abbreviation, conference: team.conference_id === null ? null : conferenceNames.get(team.conference_id) ?? null, apRank: rankByTeam.get(team.id) ?? null, wins: record.get(team.id)?.wins ?? 0, losses: record.get(team.id)?.losses ?? 0, blended: rating.blended, season: rating.season, prior: rating.prior, returningShare: rating.returningShare, netRank: rating.netRank };
      }),
  };
  writeJson(join(options.outputDirectory, "ratings.json"), ratingsFile);

  for (const folder of ["teams", "boxes"]) {
    rmSync(join(options.outputDirectory, folder), { recursive: true, force: true });
    mkdirSync(join(options.outputDirectory, folder), { recursive: true });
  }
  const logsByTeam = new Map<number, TeamGameLog[]>();
  for (const game of finals) {
    const box = boxes.get(game.id) ?? null;
    for (const atHome of [true, false]) {
      const teamId = atHome ? game.home_team.id : game.visitor_team.id;
      const entry: TeamGameLog = { gameId: game.id, date: ncaabGameDate(game), season: game.season, opponentId: atHome ? game.visitor_team.id : game.home_team.id, atHome, neutral: game.postseason, scored: atHome ? game.home_score! : game.away_score!, allowed: atHome ? game.away_score! : game.home_score!, possessions: box ? Math.round(box.possessions * 10) / 10 : null, boxAvailable: box !== null };
      logsByTeam.set(teamId, [...(logsByTeam.get(teamId) ?? []), entry]);
    }
    if (box) {
      const boxFile: BoxFile = { ...box, homeName: game.home_team.college, awayName: game.visitor_team.college };
      writeJson(join(options.outputDirectory, "boxes", `${game.id}.json`), boxFile);
    }
  }
  for (const [teamId, teamGames] of logsByTeam) {
    const teamBoxes = [...boxes.values()].filter((box) => box.homeTeamId === teamId || box.awayTeamId === teamId);
    const linesFor = (wantedSeason: number) => teamBoxes.filter((box) => box.season === wantedSeason).flatMap((box) => box.players.filter((line) => line.teamId === teamId));
    const teamFile: TeamFile = { teamId, generatedAt, games: teamGames.sort((first, second) => second.date.localeCompare(first.date)), playerAverages: [...playerAverages(linesFor(season), season), ...playerAverages(linesFor(lastSeason), lastSeason)] };
    writeJson(join(options.outputDirectory, "teams", `${teamId}.json`), teamFile);
  }

  if (options.oddsDirectory && existsSync(join(options.oddsDirectory, "picks"))) {
    const picks = readdirSync(join(options.oddsDirectory, "picks"))
      .filter((fileName) => fileName.endsWith(".json") && ncaabSeasonFor(fileName.slice(0, 10)) === season)
      .flatMap((fileName) => readJson<PicksFile>(join(options.oddsDirectory!, "picks", fileName))?.picks ?? []);
    const recordFile: RecordFile = { generatedAt, picks: gradePicks(picks, gamesById, generatedAt) };
    writeJson(join(options.outputDirectory, "record.json"), recordFile);
    log(`record: ${recordFile.picks.filter((pick) => pick.result).length} of ${recordFile.picks.length} picks graded`);
  } else if (!existsSync(join(options.outputDirectory, "record.json"))) {
    writeJson(join(options.outputDirectory, "record.json"), { generatedAt, picks: [] } satisfies RecordFile);
  }

  const boxStats: MetaFile["boxes"] = {};
  for (const [label, seasonNumber] of [["current", season], ["last", lastSeason]] as const) {
    const seasonFinals = finals.filter((game) => game.season === seasonNumber);
    const rebuilt = seasonFinals.map((game) => boxes.get(game.id)).filter((box): box is GameBox => box !== undefined);
    boxStats[`${seasonNumber}`] = { games: seasonFinals.length, rebuilt: rebuilt.length, pointsMatch: rebuilt.filter((box) => box.quality.pointsMatch).length };
    log(`${label} season ${seasonNumber}: ${rebuilt.length}/${seasonFinals.length} box scores, ${rebuilt.filter((box) => box.quality.pointsMatch).length} match the final score`);
  }
  const unparsedSample = [...boxes.values()].slice(-50).reduce((runningTotal, box) => runningTotal + box.quality.unparsedPlays, 0);
  log(`unparsed plays in the last 50 boxes: ${unparsedSample}`);
  const metaFile: MetaFile = { generatedAt, boxes: boxStats, callsUsed: client.callCount, backfillRemaining: finals.filter((game) => !boxes.has(game.id) && (failures.get(game.id) ?? 0) < 3).length };
  writeJson(join(options.outputDirectory, "meta.json"), metaFile);
  log(`done in ${Math.round((Date.now() - startedAt) / 60_000)} min, ${client.callCount} BDL calls, ${metaFile.backfillRemaining} box scores left for later nights`);
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError); // messages never include the key
  process.exit(1);
});
