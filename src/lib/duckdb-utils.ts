import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";

const TABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/;

export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function sanitizeTableName(value?: string | unknown): string {
  return typeof value === "string" && TABLE_NAME_REGEX.test(value)
    ? value
    : DEFAULT_DUCKDB_TABLE;
}

export function isNumericType(duckdbType: string): boolean {
  const type = duckdbType.toUpperCase();
  return (
    type.includes("INT") ||
    type.includes("FLOAT") ||
    type.includes("DOUBLE") ||
    type.includes("DECIMAL") ||
    type.includes("NUMERIC") ||
    type.includes("REAL") ||
    type.includes("BIGINT") ||
    type.includes("SMALLINT") ||
    type.includes("TINYINT") ||
    type === "NUMBER"
  );
}
