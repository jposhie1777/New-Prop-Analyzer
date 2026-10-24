import type { AnalyticsEngine } from "./engine";
import { createTableSql, jsonColumnsSpec, selectColumnsSql, tableNames, type DataRow, type FinalsPayload, type TableName } from "@/lib/data/rowSchemas";
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

async function insertJsonRows(engine: AnalyticsEngine, tableName: TableName, rows: DataRow[], fileName: string): Promise<number> {
  if (rows.length === 0) return 0;
  await engine.registerJsonText(fileName, JSON.stringify(rows));
  await engine.execute(`INSERT INTO ${tableName} SELECT ${selectColumnsSql(tableName)} FROM read_json('${engine.fileReference(fileName)}', format = 'array', columns = ${jsonColumnsSpec(tableName)})`);
  return rows.length;
}

export async function loadAnalyticsTables(engine: AnalyticsEngine, sources: LoadSources): Promise<LoadSummary> {
  const warnings: string[] = [];
  let baselineRows = 0;
  let topUpRows = 0;
  for (const tableName of tableNames) {
    await engine.execute(`DROP TABLE IF EXISTS ${tableName}`);
    await engine.execute(createTableSql(tableName));
  }
  await insertJsonRows(engine, "teams", teamReferences.map(flattenTeam), "static_teams.json"); // teams are static reference data

  for (const seasonEntry of Object.values(sources.manifest?.seasons ?? {})) {
    for (const [tableName, tableFile] of Object.entries(seasonEntry.tables) as Array<[TableName, { file: string; rows: number }]>) {
      if (tableName === "teams" || !tableFile || tableFile.rows === 0) continue;
      const fileName = `baseline_${seasonEntry.season}_${tableName}.parquet`;
      try {
        await engine.registerRemoteFile(fileName, `${sources.baselineBaseUrl}/${tableFile.file}`);
        await engine.execute(`INSERT INTO ${tableName} SELECT ${selectColumnsSql(tableName)} FROM read_parquet('${engine.fileReference(fileName)}')`);
        baselineRows += tableFile.rows;
      } catch (caughtError) {
        warnings.push(`could not load ${tableFile.file}: ${caughtError instanceof Error ? caughtError.message : "error"}`);
      }
    }
  }

  for (const tableName of tableNames) {
    if (tableName === "teams") continue;
    const rows = sources.topUpPayloads.flatMap((payload) => payload.tables[tableName] ?? []);
    topUpRows += await insertJsonRows(engine, tableName, rows, `topup_${tableName}.json`);
  }

  for (const statement of analyticsViewStatements) await engine.execute(statement);

  const tableRowCounts: Record<string, number> = {};
  for (const tableName of [...tableNames, "player_scope_lines", "team_scope_lines"]) {
    const [countRow] = await engine.query<{ row_count: number }>(`SELECT COUNT(*) AS row_count FROM ${tableName}`);
    tableRowCounts[tableName] = Number(countRow?.row_count ?? 0);
  }
  return { baselineRows, topUpRows, tableRowCounts, warnings };
}
