import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeRow, type AnalyticsEngine, type QueryRow } from "./engine";

export class NodeAnalyticsEngine implements AnalyticsEngine {
  private readonly scratchDirectory = mkdtempSync(join(tmpdir(), "pulse-duckdb-"));
  private readonly fileLocations = new Map<string, string>();

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
  ) {}

  static async create(): Promise<NodeAnalyticsEngine> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    return new NodeAnalyticsEngine(instance, connection);
  }

  async query<RowType = QueryRow>(sqlText: string): Promise<RowType[]> {
    const reader = await this.connection.runAndReadAll(sqlText);
    return reader.getRowObjectsJS().map((rawRow) => normalizeRow(rawRow as Record<string, unknown>)) as RowType[];
  }

  async execute(sqlText: string): Promise<void> {
    await this.connection.run(sqlText);
  }

  async registerJsonText(fileName: string, jsonText: string): Promise<void> {
    const filePath = join(this.scratchDirectory, fileName);
    writeFileSync(filePath, jsonText);
    this.fileLocations.set(fileName, filePath);
  }

  async registerRemoteFile(fileName: string, fileUrl: string): Promise<void> {
    this.fileLocations.set(fileName, fileUrl.startsWith("http") ? fileUrl : resolve(fileUrl)); // local paths for scripts and tests
  }

  fileReference(fileName: string): string {
    return (this.fileLocations.get(fileName) ?? fileName).replace(/'/g, "''");
  }

  close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}
