import { tableColumns, type DataRow, type TableName } from "@/lib/data/rowSchemas";

export function sqlLiteral(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return "NULL";
  if (typeof rawValue === "boolean") return rawValue ? "TRUE" : "FALSE";
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? String(rawValue) : "NULL";
  if (typeof rawValue === "bigint") return rawValue.toString();
  return `'${String(rawValue).replace(/'/g, "''")}'`;
}

export function insertRowsStatements(tableName: TableName, rows: DataRow[], batchSize = 400): string[] {
  const columnNames = Object.keys(tableColumns[tableName]);
  const quotedColumns = columnNames.map((columnName) => `"${columnName}"`).join(", ");
  const statements: string[] = [];
  for (let startIndex = 0; startIndex < rows.length; startIndex += batchSize) {
    const valueTuples = rows.slice(startIndex, startIndex + batchSize).map((dataRow) => `(${columnNames.map((columnName) => sqlLiteral(dataRow[columnName])).join(", ")})`);
    statements.push(`INSERT INTO ${tableName} (${quotedColumns}) VALUES ${valueTuples.join(", ")}`);
  }
  return statements;
}
