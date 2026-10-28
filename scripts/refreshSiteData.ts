import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { BdlClient } from "../src/lib/bdl/bdlClient";
import type { BdlGame } from "../src/lib/bdl/types";
import { resolveTier } from "../src/config/tiers";
import { appSettings } from "../src/config/appSettings";
import { addDays, isIsoDate, todayEastern } from "../src/lib/dates";
import { isGameFinal } from "../src/lib/data/flatten";
import { buildFinalsPayload } from "../src/lib/server/finalsBuilder";
import type { FinalsPayload } from "../src/lib/data/rowSchemas";
import { isBaselineManifest, type BaselineManifest, type BaselineSeasonEntry } from "../src/lib/data/manifest";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";
import { loadAnalyticsTables } from "../src/lib/analytics/loadTables";
import { teamRatings, injuredScorers } from "../src/lib/analytics/aggregates/teamRatings";
import { teamRest, recentTeamGameIds } from "../src/lib/analytics/aggregates/teamAggregates";
import { threeQuarterProfiles } from "../src/lib/analytics/aggregates/threeQuarters";
import { quarterProfiles } from "../src/lib/analytics/aggregates/playerAggregates";
import { encodeSnapshot, snapshotVersion, type AnalyticsSnapshot } from "../src/lib/data/snapshot";
import { teamReferences } from "../src/lib/nba/teams";
import { contentHash, writeSeasonParquet } from "./parquetWriter";
import { loadEnvironmentFiles } from "./loadEnvironment";

interface RefreshOptions {
  outputDirectory: string;
  throughDate: string;
}

function parseOptions(argumentList: string[]): RefreshOptions {
  const options: RefreshOptions = { outputDirectory: "site-data", throughDate: addDays(todayEastern(), -1) };
  for (let argumentIndex = 0; argumentIndex < argumentList.length; argumentIndex++) {
    const flag = argumentList[argumentIndex];
    if (flag === "--out") options.outputDirectory = argumentList[++argumentIndex];
    else if (flag === "--through") options.throughDate = argumentList[++argumentIndex];
  }
  if (!isIsoDate(options.throughDate)) throw new Error("--through must be YYYY-MM-DD");
  return options;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function readManifest(filePath: string): BaselineManifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isBaselineManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function manifestFiles(manifest: BaselineManifest | null): Set<string> {
  return new Set(Object.values(manifest?.seasons ?? {}).flatMap((seasonEntry) => Object.values(seasonEntry.tables).map((tableFile) => tableFile!.file)));
}

function copyBundledSeason(bundledDirectory: string, bundledEntry: BaselineSeasonEntry, outputDirectory: string): BaselineSeasonEntry {
  const seasonDirectory = join(outputDirectory, String(bundledEntry.season));
  mkdirSync(seasonDirectory, { recursive: true });
  const tables: BaselineSeasonEntry["tables"] = {};
  for (const [tableName, tableFile] of Object.entries(bundledEntry.tables)) {
    if (!tableFile) continue;
    const sourcePath = join(bundledDirectory, tableFile.file);
    const hashedName = `${tableName}.${contentHash(sourcePath)}.parquet`;
    copyFileSync(sourcePath, join(seasonDirectory, hashedName));
    tables[tableName as keyof BaselineSeasonEntry["tables"]] = { ...tableFile, file: `${bundledEntry.season}/${hashedName}` };
  }
  return { ...bundledEntry, tables };
}

async function cachedPayload(client: BdlClient, cacheDirectory: string, isoDate: string): Promise<FinalsPayload> {
  const cachePath = join(cacheDirectory, `${isoDate}.json.gz`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(gunzipSync(readFileSync(cachePath)).toString()) as FinalsPayload;
    if (cached.complete && cached.tables.shot_zones !== undefined) return cached; // finished dates never change
  }
  const payload = await buildFinalsPayload(client, isoDate);
  if (payload.complete) writeFileSync(cachePath, gzipSync(JSON.stringify(payload)));
  log(`fetched ${isoDate}: ${payload.tables.games.length} games, ${payload.bdlCalls} calls${payload.warnings.length > 0 ? ` (${payload.warnings.join("; ")})` : ""}`);
  return payload;
}

async function buildSnapshot(manifest: BaselineManifest, outputDirectory: string, forDate: string): Promise<AnalyticsSnapshot> {
  const engine = await NodeAnalyticsEngine.create();
  try {
    await loadAnalyticsTables(engine, { manifest, baselineBaseUrl: resolve(outputDirectory), topUpPayloads: [] });
    const allTeamIds = teamReferences.map((team) => team.id);
    const currentSeason = appSettings.currentSeason;
    const playerRows = await engine.query<{ player_id: number }>(`SELECT DISTINCT player_id FROM player_game_stats WHERE season IN (${currentSeason}, ${currentSeason - 1}) AND minutes > 0`);
    return {
      version: snapshotVersion,
      generatedAt: new Date().toISOString(),
      forDate,
      dataThrough: manifest.lastDate,
      currentSeason,
      teamRatings: await teamRatings(engine, currentSeason),
      teamRest: await teamRest(engine, allTeamIds, forDate),
      injuredScorers: await injuredScorers(engine, playerRows.map((playerRow) => Number(playerRow.player_id)), currentSeason),
      threeQuarterProfiles: await threeQuarterProfiles(engine, allTeamIds, [currentSeason, appSettings.lastSeason]),
      quarterProfiles: await quarterProfiles(engine, playerRows.map((playerRow) => Number(playerRow.player_id)), 10), // both seasons, so a player back from a long injury is covered
      recentTeamGameIds: await recentTeamGameIds(engine, allTeamIds, 10),
    };
  } finally {
    engine.close();
  }
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const options = parseOptions(process.argv.slice(2));
  const tier = resolveTier(process.env.BDL_TIER);
  const client = new BdlClient({ tier, apiKey: process.env.BDL_API_KEY });
  const outputDirectory = resolve(options.outputDirectory);
  const cacheDirectory = join(outputDirectory, "cache");
  const workDirectory = resolve(".site-data-work");
  mkdirSync(cacheDirectory, { recursive: true });
  const bundledDirectory = resolve("public", "data", tier === "mock" ? "mock-baseline" : "baseline");
  const bundledManifest = readManifest(join(bundledDirectory, "manifest.json"));
  const previousManifest = readManifest(join(outputDirectory, "manifest.json"));
  const currentSeason = appSettings.currentSeason;
  const lastSeason = appSettings.lastSeason;

  const seasonGames = await client.getAllPages<BdlGame>("/nba/v1/games", { "seasons[]": [currentSeason], end_date: options.throughDate });
  const finishedDates = [...new Set(seasonGames.filter((game) => isGameFinal(game) && game.date.slice(0, 10) <= options.throughDate).map((game) => game.date.slice(0, 10)))].sort();
  log(`season ${currentSeason}: ${finishedDates.length} finished dates through ${options.throughDate}`);
  const payloads = new Map<string, FinalsPayload>();
  for (const isoDate of finishedDates) payloads.set(isoDate, await cachedPayload(client, cacheDirectory, isoDate));

  const manifest: BaselineManifest = { version: 1, generatedAt: new Date().toISOString(), tier, lastDate: null, totalBytes: 0, seasons: {} };
  const lastSeasonEntry = bundledManifest?.seasons[String(lastSeason)];
  if (lastSeasonEntry) manifest.seasons[String(lastSeason)] = copyBundledSeason(bundledDirectory, lastSeasonEntry, outputDirectory); // last season is finished, the bundled copy is complete
  const usableDates = finishedDates.filter((isoDate) => payloads.get(isoDate)?.complete);
  manifest.seasons[String(currentSeason)] = await writeSeasonParquet({ season: currentSeason, dates: usableDates, readPayload: (isoDate) => payloads.get(isoDate)!, stagingRoot: workDirectory, outputDirectory, teams: [], hashedNames: true });
  manifest.lastDate = [manifest.seasons[String(currentSeason)].lastDate, lastSeasonEntry?.lastDate].filter((lastDate): lastDate is string => Boolean(lastDate)).sort().at(-1) ?? null;
  manifest.totalBytes = Object.values(manifest.seasons).reduce((seasonTotal, seasonEntry) => seasonTotal + Object.values(seasonEntry.tables).reduce((tableTotal, tableFile) => tableTotal + (tableFile?.bytes ?? 0), 0), 0);

  const keptFiles = new Set([...manifestFiles(manifest), ...manifestFiles(previousManifest)]); // yesterday's files stay one more day for browsers holding the old manifest
  for (const seasonName of readdirSync(outputDirectory).filter((entryName) => /^\d{4}$/.test(entryName))) {
    for (const fileName of readdirSync(join(outputDirectory, seasonName))) {
      if (!keptFiles.has(`${seasonName}/${fileName}`)) rmSync(join(outputDirectory, seasonName, fileName), { force: true });
    }
  }

  const forDate = todayEastern();
  const snapshot = await buildSnapshot(manifest, outputDirectory, forDate);
  const snapshotText = encodeSnapshot(snapshot);
  writeFileSync(join(outputDirectory, "snapshot.json.tmp"), snapshotText);
  renameSync(join(outputDirectory, "snapshot.json.tmp"), join(outputDirectory, "snapshot.json"));
  writeFileSync(join(outputDirectory, "manifest.json.tmp"), JSON.stringify(manifest));
  renameSync(join(outputDirectory, "manifest.json.tmp"), join(outputDirectory, "manifest.json")); // the manifest goes last, so it never points at files that are not there yet
  rmSync(workDirectory, { recursive: true, force: true });
  log(`done: stats through ${manifest.lastDate}, ${(manifest.totalBytes / 1_048_576).toFixed(2)} MB of Parquet, snapshot ${(snapshotText.length / 1024).toFixed(0)} KB for ${forDate}, ${client.callCount} BDL calls`);
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
