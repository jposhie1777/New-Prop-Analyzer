"use client";

import type { AnalyticsEngine, QueryRow } from "@/lib/analytics/engine";
import { normalizeRow } from "@/lib/analytics/engine";
import { selectColumnsSql, tableColumns, type DataRow, type DuckColumnType, type TableName } from "@/lib/data/rowSchemas";
import { Bool, Float64, Int32, Table, Utf8, vectorFromArray, type DataType, type Vector } from "apache-arrow";

type DuckModule = typeof import("@duckdb/duckdb-wasm");
type AsyncConnection = Awaited<ReturnType<InstanceType<DuckModule["AsyncDuckDB"]>["connect"]>>;

function arrowTypeFor(columnType: DuckColumnType): DataType {
  if (columnType === "INTEGER") return new Int32();
  if (columnType === "DOUBLE") return new Float64();
  if (columnType === "BOOLEAN") return new Bool();
  return new Utf8();
}

function coerceValue(rawValue: unknown, columnType: DuckColumnType): unknown {
  if (rawValue === null || rawValue === undefined) return null;
  if (columnType === "INTEGER" || columnType === "DOUBLE") {
    const numeric = typeof rawValue === "bigint" ? Number(rawValue) : Number(rawValue);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (columnType === "BOOLEAN") return Boolean(rawValue);
  return String(rawValue);
}

export function rowsToArrowTable(tableName: TableName, rows: Array<Record<string, unknown>>): Table {
  const columnVectors: Record<string, Vector> = {};
  for (const [columnName, columnType] of Object.entries(tableColumns[tableName]) as Array<[string, DuckColumnType]>) {
    columnVectors[columnName] = vectorFromArray(rows.map((row) => coerceValue(row[columnName], columnType)), arrowTypeFor(columnType)) as Vector; // typed vectors keep nulls
  }
  return new Table(columnVectors);
}

let stagingCounter = 0;

export class WasmAnalyticsEngine implements AnalyticsEngine {
  private constructor(private readonly connection: AsyncConnection) {}

  static async create(): Promise<WasmAnalyticsEngine> {
    const duckModule = await import("@duckdb/duckdb-wasm");
    const origin = window.location.origin;
    const bundle = await duckModule.selectBundle({
      mvp: { mainModule: `${origin}/duckdb/duckdb-mvp.wasm`, mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js` },
      eh: { mainModule: `${origin}/duckdb/duckdb-eh.wasm`, mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js` },
    }); // self-hosted copies made by scripts/copyDuckdbAssets.mjs
    const worker = new Worker(bundle.mainWorker!);
    const database = new duckModule.AsyncDuckDB(new duckModule.VoidLogger(), worker);
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const connection = await database.connect();
    await connection.query("SET autoinstall_known_extensions = false"); // never fetch extensions from a third-party CDN
    await connection.query("SET autoload_known_extensions = false");
    return new WasmAnalyticsEngine(connection);
  }

  async query<RowType = QueryRow>(sqlText: string): Promise<RowType[]> {
    const arrowTable = await this.connection.query(sqlText);
    return arrowTable.toArray().map((arrowRow: { toJSON: () => Record<string, unknown> }) => normalizeRow(arrowRow.toJSON())) as RowType[];
  }

  async execute(sqlText: string): Promise<void> {
    await this.connection.query(sqlText);
  }

  async insertParquetFile(tableName: TableName, fileUrl: string): Promise<number> {
    const [{ parquetReadObjects }, { compressors }] = await Promise.all([import("hyparquet"), import("hyparquet-compressors")]);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`${response.status} for ${fileUrl}`);
    const fileBuffer = await response.arrayBuffer();
    const rows = (await parquetReadObjects({ file: fileBuffer, compressors })) as Array<Record<string, unknown>>; // zstd Parquet decoded in JS, no DuckDB extension download
    return this.insertDataRows(tableName, rows as DataRow[]);
  }

  async insertDataRows(tableName: TableName, rows: DataRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const stagingName = `staging_${tableName}_${++stagingCounter}`;
    await this.connection.insertArrowTable(rowsToArrowTable(tableName, rows), { name: stagingName, create: true });
    await this.connection.query(`INSERT INTO ${tableName} SELECT ${selectColumnsSql(tableName)} FROM ${stagingName}`);
    await this.connection.query(`DROP TABLE ${stagingName}`);
    return rows.length;
  }
}
