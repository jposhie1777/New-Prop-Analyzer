import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BdlTeam } from "../src/lib/bdl/types";
import { flattenTeam } from "../src/lib/data/flatten";
import { jsonColumnsSpec, selectColumnsSql, tableNames, type FinalsPayload, type TableName } from "../src/lib/data/rowSchemas";
import type { BaselineSeasonEntry } from "../src/lib/data/manifest";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";

export interface SeasonWriteOptions {
  season: number;
  dates: string[];
  readPayload: (isoDate: string) => FinalsPayload;
  stagingRoot: string;
  outputDirectory: string;
  teams: BdlTeam[];
  hashedNames: boolean; // content-hashed file names can be cached by browsers forever
}

export function contentHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 12);
}

export async function writeSeasonParquet(options: SeasonWriteOptions): Promise<BaselineSeasonEntry> {
  const { season, dates, readPayload, stagingRoot, outputDirectory, teams, hashedNames } = options;
  const seasonDirectory = join(outputDirectory, String(season));
  mkdirSync(seasonDirectory, { recursive: true });
  const engine = await NodeAnalyticsEngine.create();
  const entry: BaselineSeasonEntry = { season, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, dateCount: dates.length, tables: {} };
  try {
    const stagingDirectory = join(stagingRoot, "staging", String(season));
    rmSync(stagingDirectory, { recursive: true, force: true });
    mkdirSync(stagingDirectory, { recursive: true });
    const rowCounts = new Map<TableName, number>();
    for (const tableName of tableNames) writeFileSync(join(stagingDirectory, `${tableName}.ndjson`), "");
    for (const isoDate of dates) {
      const payload = readPayload(isoDate);
      for (const tableName of tableNames) {
        if (tableName === "teams") continue;
        const rows = payload.tables[tableName] ?? [];
        if (rows.length === 0) continue;
        writeFileSync(join(stagingDirectory, `${tableName}.ndjson`), rows.map((dataRow) => JSON.stringify(dataRow)).join("\n") + "\n", { flag: "a" });
        rowCounts.set(tableName, (rowCounts.get(tableName) ?? 0) + rows.length);
      }
    }
    if (teams.length > 0) {
      writeFileSync(join(stagingDirectory, "teams.ndjson"), teams.map((team) => JSON.stringify(flattenTeam(team))).join("\n") + "\n");
      rowCounts.set("teams", teams.length);
    }
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
      let fileName = `${tableName}.parquet`;
      if (hashedNames) {
        fileName = `${tableName}.${contentHash(parquetPath)}.parquet`;
        renameSync(parquetPath, join(seasonDirectory, fileName));
      }
      entry.tables[tableName] = { file: `${season}/${fileName}`, rows: Number(countRow.row_count), bytes: statSync(join(seasonDirectory, fileName)).size };
    }
    rmSync(stagingDirectory, { recursive: true, force: true });
  } finally {
    engine.close();
  }
  return entry;
}
