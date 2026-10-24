import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { resolve } from "node:path";
import { normalizeRow, type AnalyticsEngine, type QueryRow } from "./engine";
import { selectColumnsSql, type DataRow, type TableName } from "@/lib/data/rowSchemas";
import { insertRowsStatements } from "./sqlInsert";

export class NodeAnalyticsEngine implements AnalyticsEngine {
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

  async insertParquetFile(tableName: TableName, fileUrl: string): Promise<number> {
    const filePath = (fileUrl.startsWith("http") ? fileUrl : resolve(fileUrl)).replace(/'/g, "''");
    const [countRow] = await this.query<{ row_count: number }>(`SELECT COUNT(*) AS row_count FROM read_parquet('${filePath}')`);
    await this.execute(`INSERT INTO ${tableName} SELECT ${selectColumnsSql(tableName)} FROM read_parquet('${filePath}')`); // native Parquet reader in Node
    return Number(countRow?.row_count ?? 0);
  }

  async insertDataRows(tableName: TableName, rows: DataRow[]): Promise<number> {
    for (const statement of insertRowsStatements(tableName, rows)) await this.execute(statement);
    return rows.length;
  }

  close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}
