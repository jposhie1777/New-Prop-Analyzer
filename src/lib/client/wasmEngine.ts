"use client";

import type { AnalyticsEngine, QueryRow } from "@/lib/analytics/engine";
import { normalizeRow } from "@/lib/analytics/engine";

type DuckModule = typeof import("@duckdb/duckdb-wasm");
type AsyncConnection = Awaited<ReturnType<InstanceType<DuckModule["AsyncDuckDB"]>["connect"]>>;

export class WasmAnalyticsEngine implements AnalyticsEngine {
  private constructor(
    private readonly duckModule: DuckModule,
    private readonly database: InstanceType<DuckModule["AsyncDuckDB"]>,
    private readonly connection: AsyncConnection,
  ) {}

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
    return new WasmAnalyticsEngine(duckModule, database, connection);
  }

  async query<RowType = QueryRow>(sqlText: string): Promise<RowType[]> {
    const arrowTable = await this.connection.query(sqlText);
    return arrowTable.toArray().map((arrowRow: { toJSON: () => Record<string, unknown> }) => normalizeRow(arrowRow.toJSON())) as RowType[];
  }

  async execute(sqlText: string): Promise<void> {
    await this.connection.query(sqlText);
  }

  async registerJsonText(fileName: string, jsonText: string): Promise<void> {
    await this.database.dropFile(fileName).catch(() => undefined);
    await this.database.registerFileText(fileName, jsonText);
  }

  async registerRemoteFile(fileName: string, fileUrl: string): Promise<void> {
    const absoluteUrl = new URL(fileUrl, window.location.origin).toString();
    await this.database.registerFileURL(fileName, absoluteUrl, this.duckModule.DuckDBDataProtocol.HTTP, false); // HTTP range reads of Parquet
  }

  fileReference(fileName: string): string {
    return fileName;
  }
}
