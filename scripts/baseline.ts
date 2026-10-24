import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BdlClient } from "../src/lib/bdl/bdlClient";
import type { BdlGame, BdlTeam } from "../src/lib/bdl/types";
import { resolveTier, tierRequestsPerMinute } from "../src/config/tiers";
import { appSettings } from "../src/config/appSettings";
import { addDays, isIsoDate, seasonForDate, todayEastern } from "../src/lib/dates";
import { buildFinalsPayload } from "../src/lib/server/finalsBuilder";
import { isGameFinal, flattenTeam } from "../src/lib/data/flatten";
import { jsonColumnsSpec, selectColumnsSql, tableNames, type FinalsPayload, type TableName } from "../src/lib/data/rowSchemas";
import type { BaselineManifest, BaselineSeasonEntry } from "../src/lib/data/manifest";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";
import { loadEnvironmentFiles } from "./loadEnvironment";

interface Checkpoint {
  tier: string;
  completedDates: Record<string, { complete: boolean; bdlCalls: number; savedAt: string }>;
}

interface CommandOptions {
  seasons: number[];
  throughDate: string;
  rebuildOnly: boolean;
  skipImages: boolean;
}

function parseOptions(argumentList: string[]): CommandOptions {
  const options: CommandOptions = { seasons: [appSettings.lastSeason, appSettings.currentSeason], throughDate: addDays(todayEastern(), -1), rebuildOnly: false, skipImages: false };
  for (let argumentIndex = 0; argumentIndex < argumentList.length; argumentIndex++) {
    const flag = argumentList[argumentIndex];
    if (flag === "--seasons") options.seasons = argumentList[++argumentIndex].split(",").map(Number);
    else if (flag === "--through") options.throughDate = argumentList[++argumentIndex];
    else if (flag === "--rebuild-only") options.rebuildOnly = true; // re-write Parquet from the checkpoint without calling BDL
    else if (flag === "--skip-images") options.skipImages = true;
  }
  if (!isIsoDate(options.throughDate)) throw new Error("--through must be YYYY-MM-DD");
  if (options.throughDate >= todayEastern()) options.throughDate = addDays(todayEastern(), -1); // today is never final
  return options;
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, filePath); // rename is atomic, so a crash never leaves half a file
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "--";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

async function listFinishedDates(client: BdlClient, season: number, throughDate: string): Promise<string[]> {
  const games = await client.getAllPages<BdlGame>("/nba/v1/games", { "seasons[]": [season], end_date: throughDate });
  const finishedDates = new Set<string>();
  for (const game of games) if (isGameFinal(game) && game.date <= throughDate) finishedDates.add(game.date);
  return [...finishedDates].sort();
}

async function writeSeasonParquet(season: number, seasonDates: string[], workDirectory: string, outputDirectory: string, teams: BdlTeam[]): Promise<BaselineSeasonEntry> {
  const seasonDirectory = join(outputDirectory, String(season));
  mkdirSync(seasonDirectory, { recursive: true });
  const engine = await NodeAnalyticsEngine.create();
  const entry: BaselineSeasonEntry = { season, firstDate: seasonDates[0] ?? null, lastDate: seasonDates.at(-1) ?? null, dateCount: seasonDates.length, tables: {} };
  try {
    const stagingDirectory = join(workDirectory, "staging", String(season));
    rmSync(stagingDirectory, { recursive: true, force: true });
    mkdirSync(stagingDirectory, { recursive: true });
    const rowCounts = new Map<TableName, number>();
    for (const tableName of tableNames) writeFileSync(join(stagingDirectory, `${tableName}.ndjson`), "");
    for (const isoDate of seasonDates) {
      const payload = JSON.parse(readFileSync(join(workDirectory, "dates", `${isoDate}.json`), "utf8")) as FinalsPayload;
      for (const tableName of tableNames) {
        if (tableName === "teams") continue;
        const rows = payload.tables[tableName] ?? [];
        if (rows.length === 0) continue;
        writeFileSync(join(stagingDirectory, `${tableName}.ndjson`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "a" });
        rowCounts.set(tableName, (rowCounts.get(tableName) ?? 0) + rows.length);
      }
    }
    writeFileSync(join(stagingDirectory, "teams.ndjson"), teams.map((team) => JSON.stringify(flattenTeam(team))).join("\n") + "\n");
    rowCounts.set("teams", teams.length);
    for (const tableName of tableNames) {
      const rowCount = rowCounts.get(tableName) ?? 0;
      const parquetPath = join(seasonDirectory, `${tableName}.parquet`);
      if (rowCount === 0) {
        rmSync(parquetPath, { force: true });
        continue;
      }
      const stagingPath = resolve(join(stagingDirectory, `${tableName}.ndjson`)).replace(/'/g, "''");
      const dedupeClause = tableName === "players" ? " QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY last_seen_date DESC) = 1" : "";
      await engine.execute(
        `COPY (SELECT ${selectColumnsSql(tableName)} FROM read_json('${stagingPath}', format = 'newline_delimited', columns = ${jsonColumnsSpec(tableName)})${dedupeClause})
         TO '${resolve(parquetPath).replace(/'/g, "''")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
      );
      const [countRow] = await engine.query<{ row_count: number }>(`SELECT COUNT(*) AS row_count FROM read_parquet('${resolve(parquetPath).replace(/'/g, "''")}')`);
      entry.tables[tableName] = { file: `${season}/${tableName}.parquet`, rows: Number(countRow.row_count), bytes: statSync(parquetPath).size };
    }
    rmSync(stagingDirectory, { recursive: true, force: true });
  } finally {
    engine.close();
  }
  return entry;
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const options = parseOptions(process.argv.slice(2));
  const tier = resolveTier(process.env.BDL_TIER);
  const outputDirectory = resolve("public", "data", tier === "mock" ? "mock-baseline" : "baseline");
  const workDirectory = resolve(".baseline-work", tier);
  mkdirSync(join(workDirectory, "dates"), { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  const checkpointPath = join(workDirectory, "checkpoint.json");
  const checkpoint: Checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : { tier, completedDates: {} };

  const client = new BdlClient({ tier, apiKey: process.env.BDL_API_KEY });
  console.log(`Pulse NBA baseline | tier=${tier} (${tierRequestsPerMinute[tier]} req/min) | seasons=${options.seasons.join(",")} | through=${options.throughDate}`);
  if (tier === "trial" || tier === "free") console.log("Note: on trial/free, odds, advanced stats, lineups and play-by-play need GOAT, so those tables stay empty and this runs at 5 req/min.");

  const teamsResponse = await client.get<{ data: BdlTeam[] }>("/nba/v1/teams", {});
  const teams = teamsResponse.data.filter((team) => team.conference && team.division && team.id <= 30); // BDL also lists historical franchises

  const datesBySeason = new Map<number, string[]>();
  for (const season of options.seasons) {
    if (options.rebuildOnly) {
      datesBySeason.set(season, Object.keys(checkpoint.completedDates).filter((isoDate) => seasonForDate(isoDate) === season && isoDate <= options.throughDate && existsSync(join(workDirectory, "dates", `${isoDate}.json`))).sort());
      continue;
    }
    const seasonDates = await listFinishedDates(client, season, options.throughDate);
    datesBySeason.set(season, seasonDates);
    console.log(`season ${season}: ${seasonDates.length} finished dates`);
  }

  if (!options.rebuildOnly) {
    const pendingDates = [...datesBySeason.values()].flat().filter((isoDate) => {
      const done = checkpoint.completedDates[isoDate];
      return !done || !done.complete || !existsSync(join(workDirectory, "dates", `${isoDate}.json`)); // idempotent: finished dates are skipped
    });
    console.log(`${pendingDates.length} date(s) to fetch, ${Object.keys(checkpoint.completedDates).length} already in checkpoint`);
    const startedAt = Date.now();
    for (let dateIndex = 0; dateIndex < pendingDates.length; dateIndex++) {
      const isoDate = pendingDates[dateIndex];
      const payload = await buildFinalsPayload(client, isoDate);
      writeJsonAtomically(join(workDirectory, "dates", `${isoDate}.json`), payload);
      checkpoint.completedDates[isoDate] = { complete: payload.complete, bdlCalls: payload.bdlCalls, savedAt: new Date().toISOString() };
      writeJsonAtomically(checkpointPath, checkpoint);
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const secondsPerDate = elapsedSeconds / (dateIndex + 1);
      const remainingSeconds = secondsPerDate * (pendingDates.length - dateIndex - 1);
      const percentDone = (((dateIndex + 1) / pendingDates.length) * 100).toFixed(1);
      const warningText = payload.warnings.length > 0 ? ` | ${payload.warnings.join("; ")}` : "";
      console.log(`[${dateIndex + 1}/${pendingDates.length} ${percentDone}%] ${isoDate} games=${payload.tables.games.length} calls=${payload.bdlCalls} | total calls=${client.callCount} peak/min=${client.rateBudget.peakObservedPerMinute()} | ETA ${formatDuration(remainingSeconds)}${warningText}`);
    }
  }

  const manifest: BaselineManifest = { version: 1, generatedAt: new Date().toISOString(), tier, lastDate: null, totalBytes: 0, seasons: {} };
  for (const [season, seasonDates] of datesBySeason) {
    const availableDates = seasonDates.filter((isoDate) => existsSync(join(workDirectory, "dates", `${isoDate}.json`)));
    const seasonEntry = await writeSeasonParquet(season, availableDates, workDirectory, outputDirectory, teams);
    manifest.seasons[String(season)] = seasonEntry;
    const seasonBytes = Object.values(seasonEntry.tables).reduce((runningTotal, tableFile) => runningTotal + (tableFile?.bytes ?? 0), 0);
    manifest.totalBytes += seasonBytes;
    console.log(`season ${season}: wrote ${Object.keys(seasonEntry.tables).length} parquet files (${(seasonBytes / 1_048_576).toFixed(2)} MB)`);
  }
  const coveredDates = Object.values(manifest.seasons).map((seasonEntry) => seasonEntry.lastDate).filter((lastDate): lastDate is string => Boolean(lastDate)).sort();
  manifest.lastDate = coveredDates.at(-1) ?? null;
  for (const entryName of readdirSync(outputDirectory)) {
    if (/^\d{4}$/.test(entryName) && !manifest.seasons[entryName]) console.log(`note: ${entryName}/ is not in this run's seasons and is left out of the manifest`);
  }
  writeJsonAtomically(join(outputDirectory, "manifest.json"), manifest);
  console.log(`manifest written: last date ${manifest.lastDate ?? "none"}, ${(manifest.totalBytes / 1_048_576).toFixed(2)} MB total, ${client.callCount} BDL calls this run`);

  if (!options.skipImages) {
    try {
      const { buildNbaPersonIds } = await import("./buildNbaPersonIds");
      await buildNbaPersonIds({ outputDirectory, quiet: false });
    } catch (caughtError) {
      console.log(`image mapping skipped: ${caughtError instanceof Error ? caughtError.message : "error"} (run npm run images:map later)`);
    }
  }
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
