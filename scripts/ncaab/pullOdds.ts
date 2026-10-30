import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BdlClient } from "../../src/lib/bdl/bdlClient";
import { addDays, todayEastern } from "../../src/lib/dates";
import { appSettings } from "../../src/config/appSettings";
import { mockNcaabOdds } from "../../src/lib/bdl/mock/mockNcaab";
import { analyzeNcaabGame, eventToBettingOdds, matchOddsEvents, ncaabPickFromEdge, type OddsApiEvent } from "../../src/lib/ncaab/lines";
import { isNcaabFinal, ncaabGameDate, type NcaabGame } from "../../src/lib/ncaab/types";
import type { OddsFile, PicksFile, RatingsFile, RecordFile } from "../../src/lib/ncaab/dataFiles";
import { ncaabTier } from "../../src/lib/ncaab/ncaabTier";
import { summarizeRecord } from "../../src/lib/tracking/tracker";
import { loadEnvironmentFiles } from "../loadEnvironment";

const oddsUrl = "https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds";
const keepOddsDays = 21; // older odds files are dropped; picks are kept all season

interface PullOptions {
  outputDirectory: string;
  dataDirectory: string; // a checkout of ncaab-data, for ratings and the graded record
}

function parseOptions(argumentList: string[]): PullOptions {
  const options: PullOptions = { outputDirectory: "ncaab-odds", dataDirectory: "ncaab-data" };
  for (let argumentIndex = 0; argumentIndex < argumentList.length; argumentIndex++) {
    const flag = argumentList[argumentIndex];
    if (flag === "--out") options.outputDirectory = argumentList[++argumentIndex];
    else if (flag === "--data") options.dataDirectory = argumentList[++argumentIndex];
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

async function fetchOdds(apiKey: string): Promise<{ events: OddsApiEvent[]; remaining: number | null; used: number | null }> {
  const query = new URLSearchParams({ apiKey, regions: "us", markets: "h2h,spreads,totals", oddsFormat: "american", dateFormat: "iso" });
  let response: Response;
  try {
    response = await fetch(`${oddsUrl}?${query}`);
  } catch {
    throw new Error("Odds API request failed (network)"); // never print the URL, it carries the key
  }
  if (!response.ok) throw new Error(`Odds API ${response.status}`);
  const headerNumber = (name: string) => (response.headers.get(name) === null ? null : Number(response.headers.get(name)));
  return { events: (await response.json()) as OddsApiEvent[], remaining: headerNumber("x-requests-remaining"), used: headerNumber("x-requests-used") };
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const options = parseOptions(process.argv.slice(2));
  const tier = ncaabTier();
  const apiKey = process.env.ODDS_API_KEY ?? "";
  if (tier !== "mock" && !apiKey) {
    log("ODDS_API_KEY is not set, skipping the odds pull");
    return;
  }
  const client = new BdlClient({ tier, apiKey: process.env.BDL_API_KEY });
  const today = todayEastern();
  const dates = [today, addDays(today, 1)];
  const games = await client.getAllPages<NcaabGame>("/ncaab/v1/games", { "dates[]": dates });
  const upcoming = games.filter((game) => !isNcaabFinal(game) && new Date(game.date).getTime() > Date.now());
  if (upcoming.length === 0) {
    log("no upcoming games today or tomorrow, no credits spent");
    return;
  }

  const { events, remaining, used } = tier === "mock" ? { events: dates.flatMap((isoDate) => mockNcaabOdds(isoDate)) as OddsApiEvent[], remaining: null, used: null } : await fetchOdds(apiKey);
  const { matched, unmatched } = matchOddsEvents(events, games);
  log(`${events.length} events, ${matched.size} matched to BDL games, ${unmatched.length} unmatched; credits remaining ${remaining ?? "n/a"}`);

  const ratings = readJson<RatingsFile>(join(options.dataDirectory, "ratings.json"));
  const record = readJson<RecordFile>(join(options.dataDirectory, "record.json"));
  const marketRecords = new Map(["spread", "total", "moneyline"].map((market) => {
    const summary = summarizeRecord((record?.picks ?? []).filter((pick) => pick.kind === market));
    return [market, { decided: summary.wins + summary.losses, roiPercent: summary.roiPercent }];
  }));
  const ratingsById = new Map((ratings?.teams ?? []).map((team) => [team.id, team]));
  if (!ratings) log("no ratings.json yet, saving odds without picks");

  const pulledAt = new Date().toISOString();
  mkdirSync(join(options.outputDirectory, "odds"), { recursive: true });
  mkdirSync(join(options.outputDirectory, "picks"), { recursive: true });
  for (const isoDate of dates) {
    const oddsPath = join(options.outputDirectory, "odds", `${isoDate}.json`);
    const oddsFile: OddsFile = readJson<OddsFile>(oddsPath) ?? { date: isoDate, pulls: [], opening: {}, current: {}, unmatched: [] };
    const dayGames = games.filter((game) => ncaabGameDate(game) === isoDate);
    for (const game of dayGames) {
      const event = matched.get(game.id);
      if (!event || new Date(game.date).getTime() <= Date.now()) continue; // lines after tip-off are live lines; keep the last pre-game ones
      const bettingOdds = eventToBettingOdds(event, game);
      if (bettingOdds.length === 0) continue;
      oddsFile.opening[game.id] ??= bettingOdds;
      oddsFile.current[game.id] = bettingOdds;
    }
    oddsFile.unmatched = unmatched.filter((event) => ncaabGameDate({ date: event.commence_time }) === isoDate).map((event) => ({ home: event.home_team, away: event.away_team, commenceTime: event.commence_time }));
    oddsFile.pulls.push({ at: pulledAt, creditsRemaining: remaining, creditsUsed: used, events: dayGames.filter((game) => matched.has(game.id)).length });
    writeFileSync(oddsPath, JSON.stringify(oddsFile));

    if (!ratings) continue;
    const picksPath = join(options.outputDirectory, "picks", `${isoDate}.json`);
    const picksFile: PicksFile = readJson<PicksFile>(picksPath) ?? { date: isoDate, picks: [] };
    for (const game of dayGames) {
      const odds = oddsFile.current[game.id];
      const home = ratingsById.get(game.home_team.id);
      const away = ratingsById.get(game.visitor_team.id);
      if (!odds || !home || !away || new Date(game.date).getTime() <= Date.now()) continue;
      const analysis = analyzeNcaabGame({ game, home, away, league: ratings.league, odds, openingOdds: oddsFile.opening[game.id] ?? null, evThresholdPercent: appSettings.defaultEvThresholdPercent, marketRecords });
      const flagged = analysis.edges.filter((edge) => edge.flagged).map((edge) => ncaabPickFromEdge(edge, game, analysis.projection, analysis.confidence.get(edge.selection) ?? null, pulledAt));
      picksFile.picks = [...picksFile.picks.filter((pick) => pick.gameId !== game.id || pick.result !== null), ...flagged]; // the last pull before tip-off decides the pick
    }
    writeFileSync(picksPath, JSON.stringify(picksFile));
    log(`${isoDate}: ${Object.keys(oddsFile.current).length} games with odds, ${picksFile.picks.length} picks`);
  }

  const oldest = addDays(today, -keepOddsDays);
  for (const fileName of readdirSync(join(options.outputDirectory, "odds"))) if (fileName.slice(0, 10) < oldest) rmSync(join(options.outputDirectory, "odds", fileName));
  if (!existsSync(join(options.outputDirectory, "README.md"))) writeFileSync(join(options.outputDirectory, "README.md"), "# NCAAB odds\n\nWritten three times a day by the NCAAB odds workflow. History is replaced each run; never merge this branch.\n");
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
