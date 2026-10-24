export type QueryRow = Record<string, unknown>;

import type { DataRow, TableName } from "@/lib/data/rowSchemas";

export interface AnalyticsEngine {
  query<RowType = QueryRow>(sqlText: string): Promise<RowType[]>;
  execute(sqlText: string): Promise<void>;
  insertParquetFile(tableName: TableName, fileUrl: string): Promise<number>; // appends a baseline Parquet file to a table
  insertDataRows(tableName: TableName, rows: DataRow[]): Promise<number>; // appends flattened top-up rows to a table
}

export function normalizeValue(rawValue: unknown): unknown {
  if (typeof rawValue === "bigint") return Number(rawValue); // COUNT(*) and friends come back as BIGINT
  if (rawValue instanceof Date) return rawValue.toISOString();
  if (rawValue && typeof rawValue === "object" && "toJSON" in rawValue && typeof (rawValue as { toJSON: unknown }).toJSON === "function") return normalizeValue((rawValue as { toJSON: () => unknown }).toJSON());
  return rawValue;
}

export function normalizeRow(rawRow: Record<string, unknown>): QueryRow {
  const normalized: QueryRow = {};
  for (const [columnName, rawValue] of Object.entries(rawRow)) normalized[columnName] = normalizeValue(rawValue);
  return normalized;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`; // escape single quotes for SQL literals
}

export function sqlNumber(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`not a number: ${String(value)}`);
  return String(parsed);
}

export function sqlNumberList(values: unknown[]): string {
  const numbers = values.map(sqlNumber);
  return numbers.length > 0 ? numbers.join(", ") : "NULL";
}
