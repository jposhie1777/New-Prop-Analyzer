import { mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BdlClient } from "@/lib/bdl/bdlClient";
import { buildFinalsPayload } from "@/lib/server/finalsBuilder";
import { NodeAnalyticsEngine } from "@/lib/analytics/nodeEngine";
import { loadAnalyticsTables, type LoadSummary } from "@/lib/analytics/loadTables";
import { jsonColumnsSpec, selectColumnsSql, tableNames, type FinalsPayload, type TableName } from "@/lib/data/rowSchemas";
import type { BaselineManifest } from "@/lib/data/manifest";
import { dateRange } from "@/lib/dates";

export interface MockAnalyticsFixture {
  engine: NodeAnalyticsEngine;
  summary: LoadSummary;
  baselinePayloads: FinalsPayload[];
  topUpPayloads: FinalsPayload[];
}

export async function buildMockAnalytics(baselineDates: string[], topUpDates: string[]): Promise<MockAnalyticsFixture> {
  const client = new BdlClient({ tier: "mock" });
  const baselinePayloads: FinalsPayload[] = [];
  for (const isoDate of baselineDates) baselinePayloads.push(await buildFinalsPayload(client, isoDate));
  const topUpPayloads: FinalsPayload[] = [];
  for (const isoDate of topUpDates) topUpPayloads.push(await buildFinalsPayload(client, isoDate));
  const baselineDirectory = mkdtempSync(join(tmpdir(), "pulse-baseline-"));
  const engine = await NodeAnalyticsEngine.create();
  const seasons = new Map<number, FinalsPayload[]>();
  for (const payload of baselinePayloads) {
    const season = Number(payload.tables.games[0]?.season ?? 0);
    if (!season) continue;
    seasons.set(season, [...(seasons.get(season) ?? []), payload]);
  }
  const manifest: BaselineManifest = { version: 1, generatedAt: new Date().toISOString(), tier: "mock", lastDate: baselineDates.at(-1) ?? null, totalBytes: 0, seasons: {} };
  for (const [season, payloads] of seasons) {
    mkdirSync(join(baselineDirectory, String(season)), { recursive: true });
    manifest.seasons[String(season)] = { season, firstDate: payloads[0].date, lastDate: payloads.at(-1)!.date, dateCount: payloads.length, tables: {} };
    for (const tableName of tableNames as TableName[]) {
      if (tableName === "teams") continue;
      const rows = payloads.flatMap((payload) => payload.tables[tableName]);
      if (rows.length === 0) continue;
      const stagingPath = join(baselineDirectory, `${season}-${tableName}.json`);
      writeFileSync(stagingPath, JSON.stringify(rows));
      const parquetPath = join(baselineDirectory, String(season), `${tableName}.parquet`);
      await engine.execute(`COPY (SELECT ${selectColumnsSql(tableName)} FROM read_json('${stagingPath}', format = 'array', columns = ${jsonColumnsSpec(tableName)})) TO '${parquetPath}' (FORMAT parquet, COMPRESSION zstd)`);
      manifest.seasons[String(season)].tables[tableName] = { file: `${season}/${tableName}.parquet`, rows: rows.length, bytes: statSync(parquetPath).size };
    }
  }
  const summary = await loadAnalyticsTables(engine, { manifest, baselineBaseUrl: baselineDirectory, topUpPayloads });
  return { engine, summary, baselinePayloads, topUpPayloads };
}

export function mockDates(startDate: string, endDate: string): string[] {
  return dateRange(startDate, endDate);
}
