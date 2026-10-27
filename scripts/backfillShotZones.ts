import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BdlClient } from "../src/lib/bdl/bdlClient";
import type { BdlShotChartRow } from "../src/lib/bdl/types";
import { resolveTier, tierRequestsPerMinute } from "../src/config/tiers";
import { aggregateShotZones, type ShotGameContext } from "../src/lib/data/shotZones";
import { jsonColumnsSpec, selectColumnsSql, type DataRow, type FinalsPayload } from "../src/lib/data/rowSchemas";
import { isBaselineManifest, type BaselineManifest } from "../src/lib/data/manifest";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";
import { loadEnvironmentFiles } from "./loadEnvironment";

const gamesPerRequest = 10; // about 1,800 shots, 18 pages

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, filePath);
}

function sqlPath(filePath: string): string {
  return resolve(filePath).replace(/'/g, "''");
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const tier = resolveTier(process.env.BDL_TIER);
  if (tier === "trial" || tier === "free" || tier === "allstar") throw new Error("Shot charts need the GOAT tier.");
  const outputDirectory = resolve("public", "data", tier === "mock" ? "mock-baseline" : "baseline");
  const manifestPath = join(outputDirectory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("No baseline yet: run npm run baseline first (it includes shot zones).");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isBaselineManifest(manifest)) throw new Error("manifest.json is not a baseline manifest");
  const workDirectory = resolve(".baseline-work", tier);
  const datesDirectory = join(workDirectory, "dates");
  mkdirSync(workDirectory, { recursive: true });

  const client = new BdlClient({ tier, apiKey: process.env.BDL_API_KEY });
  console.log(`Pulse NBA shot-zone backfill | tier=${tier} (${tierRequestsPerMinute[tier]} req/min) | seasons=${Object.keys(manifest.seasons).join(",")}`);
  const engine = await NodeAnalyticsEngine.create();
  try {
    for (const [seasonKey, seasonEntry] of Object.entries((manifest as BaselineManifest).seasons)) {
      const gamesFile = seasonEntry.tables.games;
      if (!gamesFile) continue;
      const gameRows = await engine.query<{ game_id: number; game_date: string; home_team_id: number; visitor_team_id: number }>(
        `SELECT game_id, game_date, home_team_id, visitor_team_id FROM read_parquet('${sqlPath(join(outputDirectory, gamesFile.file))}') ORDER BY game_date, game_id`,
      );
      const contexts = new Map<number, ShotGameContext>(gameRows.map((gameRow) => [Number(gameRow.game_id), { season: Number(seasonKey), gameDate: String(gameRow.game_date), homeTeamId: Number(gameRow.home_team_id), visitorTeamId: Number(gameRow.visitor_team_id) }]));
      const progressPath = join(workDirectory, `shot-zones-${seasonKey}.ndjson`); // finished chunks, so a rerun picks up where it stopped
      const doneGameIds = new Set<number>();
      const zoneRows: DataRow[] = [];
      if (existsSync(progressPath)) {
        for (const line of readFileSync(progressPath, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const saved = JSON.parse(line) as { gameIds: number[]; rows: DataRow[] };
          saved.gameIds.forEach((gameId) => doneGameIds.add(gameId));
          zoneRows.push(...saved.rows);
        }
      }
      const pendingIds = [...contexts.keys()].filter((gameId) => !doneGameIds.has(gameId));
      console.log(`season ${seasonKey}: ${contexts.size} games, ${pendingIds.length} to fetch`);
      const startedAt = Date.now();
      for (let startIndex = 0; startIndex < pendingIds.length; startIndex += gamesPerRequest) {
        const gameIdChunk = pendingIds.slice(startIndex, startIndex + gamesPerRequest);
        const shots = await client.getAllPages<BdlShotChartRow>("/nba/v1/shot_charts", { "game_ids[]": gameIdChunk });
        const chunkRows = aggregateShotZones(shots, contexts);
        zoneRows.push(...chunkRows);
        writeFileSync(progressPath, JSON.stringify({ gameIds: gameIdChunk, rows: chunkRows }) + "\n", { flag: "a" });
        const doneCount = Math.min(startIndex + gamesPerRequest, pendingIds.length);
        const secondsLeft = ((Date.now() - startedAt) / 1000 / doneCount) * (pendingIds.length - doneCount);
        console.log(`  ${doneCount}/${pendingIds.length} games | ${shots.length} shots | calls=${client.callCount} | ETA ${Math.ceil(secondsLeft / 60)} min`);
      }

      const stagingPath = join(workDirectory, `shot-zones-${seasonKey}.staging.ndjson`);
      writeFileSync(stagingPath, zoneRows.map((dataRow) => JSON.stringify(dataRow)).join("\n") + "\n");
      const parquetFile = `${seasonKey}/shot_zones.parquet`;
      const parquetPath = join(outputDirectory, parquetFile);
      if (zoneRows.length > 0) {
        await engine.execute(
          `COPY (SELECT ${selectColumnsSql("shot_zones")} FROM read_json('${sqlPath(stagingPath)}', format = 'newline_delimited', columns = ${jsonColumnsSpec("shot_zones")}))
           TO '${sqlPath(parquetPath)}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
        );
        const previousBytes = seasonEntry.tables.shot_zones?.bytes ?? 0;
        seasonEntry.tables.shot_zones = { file: parquetFile, rows: zoneRows.length, bytes: statSync(parquetPath).size };
        (manifest as BaselineManifest).totalBytes += seasonEntry.tables.shot_zones.bytes - previousBytes;
        console.log(`season ${seasonKey}: wrote ${zoneRows.length} zone rows (${(seasonEntry.tables.shot_zones.bytes / 1_048_576).toFixed(2)} MB)`);
      }

      if (existsSync(datesDirectory)) {
        const rowsByDate = new Map<string, DataRow[]>();
        for (const zoneRow of zoneRows) rowsByDate.set(String(zoneRow.game_date), [...(rowsByDate.get(String(zoneRow.game_date)) ?? []), zoneRow]);
        for (const [isoDate, dateRows] of rowsByDate) {
          const datePath = join(datesDirectory, `${isoDate}.json`);
          if (!existsSync(datePath)) continue;
          const payload = JSON.parse(readFileSync(datePath, "utf8")) as FinalsPayload;
          payload.tables.shot_zones = dateRows;
          writeJsonAtomically(datePath, payload); // a later npm run baseline keeps these zones
        }
      }
    }
  } finally {
    engine.close();
  }
  writeJsonAtomically(manifestPath, manifest);
  console.log(`manifest updated, ${client.callCount} BDL calls this run. Reload the app to load the shot zones.`);
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
