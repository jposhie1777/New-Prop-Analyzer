import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { BaselineManifest } from "../src/lib/data/manifest";

async function main(): Promise<void> {
  const baselineDirectory = resolve(process.argv[2] ?? "public/data/baseline");
  const manifestPath = resolve(baselineDirectory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`no manifest at ${manifestPath}; run npm run baseline first`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BaselineManifest;
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const fileGlob = (tableName: string) => `'${baselineDirectory.replace(/'/g, "''")}/*/${tableName}.parquet'`;
  const runQuery = async (sqlText: string) => (await connection.runAndReadAll(sqlText)).getRowObjectsJson();
  console.log(`baseline thru ${manifest.lastDate} · ${(manifest.totalBytes / 1_048_576).toFixed(2)} MB · seasons ${Object.keys(manifest.seasons).join(", ")}`);
  const [coverage] = await runQuery(`
    WITH full_games AS (SELECT * FROM read_parquet(${fileGlob("player_game_stats")}) WHERE minutes > 0),
    quarter_totals AS (SELECT game_id, player_id, SUM(pts) AS quarter_points, COUNT(*) AS quarter_rows FROM read_parquet(${fileGlob("player_period_stats")}) GROUP BY game_id, player_id)
    SELECT COUNT(*) AS player_games, SUM(quarter_totals.player_id IS NOT NULL) AS with_quarters,
      ROUND(100.0 * SUM(quarter_totals.quarter_points = full_games.pts) / COUNT(*), 1) AS points_match_pct, ROUND(AVG(full_games.pts - quarter_totals.quarter_points), 2) AS average_gap
    FROM full_games LEFT JOIN quarter_totals USING (game_id, player_id)`);
  console.log(`player-games ${coverage.player_games} · with quarter rows ${coverage.with_quarters} · quarter points = full game in ${coverage.points_match_pct}% (avg gap ${coverage.average_gap})`);
  const pace = await runQuery(`SELECT possessions_source, COUNT(*) AS team_quarters, ROUND(AVG(pace), 1) AS pace FROM read_parquet(${fileGlob("team_period_summaries")}) GROUP BY 1`);
  for (const paceRow of pace) console.log(`pace from ${paceRow.possessions_source}: ${paceRow.pace} over ${paceRow.team_quarters} team-quarters`);
  const [advanced] = await runQuery(`SELECT COUNT(*) AS advanced_rows, COUNT(DISTINCT period) AS periods FROM read_parquet(${fileGlob("advanced_stats")})`);
  console.log(`advanced stats rows ${advanced.advanced_rows} across ${advanced.periods} period values`);
  const verdict = Number(coverage.points_match_pct) >= 95 ? "OK" : "CHECK: quarter stats do not add up to full games";
  console.log(`verdict: ${verdict}`);
  connection.closeSync();
  instance.closeSync();
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
