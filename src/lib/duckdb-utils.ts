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

export function deriveTableNameFromFilename(
  filename: string,
  fallback: string = DEFAULT_DUCKDB_TABLE,
): string {
  if (!filename || typeof filename !== "string") return fallback;
  const base = filename.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) return fallback;
  // Ensure starts with a letter or underscore
  const safe = /^[a-z_]/.test(normalized) ? normalized : `t_${normalized}`;
  return TABLE_NAME_REGEX.test(safe) ? safe : fallback;
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
