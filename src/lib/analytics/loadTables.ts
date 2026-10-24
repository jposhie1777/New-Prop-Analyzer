import type { AnalyticsEngine } from "./engine";
import { createTableSql, tableNames, type FinalsPayload, type TableName } from "@/lib/data/rowSchemas";
import type { BaselineManifest } from "@/lib/data/manifest";
import { flattenTeam } from "@/lib/data/flatten";
import { teamReferences } from "@/lib/nba/teams";
import { analyticsViewStatements } from "./views";

export interface LoadSources {
  manifest: BaselineManifest | null;
  baselineBaseUrl: string; // folder that holds {season}/{table}.parquet
  topUpPayloads: FinalsPayload[];
}

export interface LoadSummary {
  baselineRows: number;
  topUpRows: number;
  tableRowCounts: Record<string, number>;
  warnings: string[];
}

export async function loadAnalyticsTables(engine: AnalyticsEngine, sources: LoadSources): Promise<LoadSummary> {
  const warnings: string[] = [];
  let baselineRows = 0;
  let topUpRows = 0;
  for (const tableName of tableNames) {
    await engine.execute(`DROP TABLE IF EXISTS ${tableName}`);
    await engine.execute(createTableSql(tableName));
  }
  await engine.insertDataRows("teams", teamReferences.map(flattenTeam)); // teams are static reference data

  for (const seasonEntry of Object.values(sources.manifest?.seasons ?? {})) {
    for (const [tableName, tableFile] of Object.entries(seasonEntry.tables) as Array<[TableName, { file: string; rows: number }]>) {
      if (tableName === "teams" || !tableFile || tableFile.rows === 0) continue;
      try {
        await engine.insertParquetFile(tableName, `${sources.baselineBaseUrl}/${tableFile.file}`);
        baselineRows += tableFile.rows;
      } catch (caughtError) {
        warnings.push(`could not load ${tableFile.file}: ${caughtError instanceof Error ? caughtError.message : "error"}`);
      }
    }
  }

  for (const tableName of tableNames) {
    if (tableName === "teams") continue;
    const rows = sources.topUpPayloads.flatMap((payload) => payload.tables[tableName] ?? []);
    topUpRows += await engine.insertDataRows(tableName, rows);
  }

  for (const statement of analyticsViewStatements) await engine.execute(statement);

  const tableRowCounts: Record<string, number> = {};
  for (const tableName of [...tableNames, "player_scope_lines", "team_scope_lines"]) {
    const [countRow] = await engine.query<{ row_count: number }>(`SELECT COUNT(*) AS row_count FROM ${tableName}`);
    tableRowCounts[tableName] = Number(countRow?.row_count ?? 0);
  }
  return { baselineRows, topUpRows, tableRowCounts, warnings };
}
