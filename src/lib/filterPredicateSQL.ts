import { escapeIdentifier } from "./duckdb-utils";

export interface SQLFilterResult {
  sql: string;
  params: unknown[];
}

export function parseFilterToSQL(
  columnName: string,
  filterValue: string,
  isNumeric: boolean = false,
): SQLFilterResult {
  const trimmed = filterValue.trim();
  if (!trimmed) {
    return { sql: "1=1", params: [] };
  }

  const columnIdent = escapeIdentifier(columnName);

  const lower = trimmed.toLowerCase();
  if (lower === "is:empty" || lower === "is:null") {
    return { sql: `(${columnIdent} IS NULL OR ${columnIdent} = '')`, params: [] };
  }
  if (lower === "is:notempty" || lower === "is:filled") {
    return { sql: `(${columnIdent} IS NOT NULL AND ${columnIdent} != '')`, params: [] };
  }

  const orParts = trimmed.split(/\s+or\s+|\|\|/i).map(s => s.trim()).filter(Boolean);
  if (orParts.length > 1) {
    const orConditions = orParts.map(part => {
      const subResult = parseFilterToSQL(columnName, part, isNumeric);
      return { sql: `(${subResult.sql})`, params: subResult.params };
    });
    const sql = orConditions.map(c => c.sql).join(" OR ");
    const params = orConditions.flatMap(c => c.params);
    return { sql: `(${sql})`, params };
  }

  if (trimmed.startsWith("!") && trimmed.length > 1) {
    const value = trimmed.slice(1).trim();
    if (isNumeric) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return { sql: `${columnIdent} != ?`, params: [num] };
      }
    }
    return { sql: `LOWER(CAST(${columnIdent} AS VARCHAR)) NOT LIKE LOWER(?)`, params: [`%${value}%`] };
  }

  if (trimmed.startsWith("=") && trimmed.length > 1) {
    const value = trimmed.slice(1).trim();
    if (isNumeric) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return { sql: `${columnIdent} = ?`, params: [num] };
      }
    }
    return { sql: `CAST(${columnIdent} AS VARCHAR) = ?`, params: [value] };
  }

  if (trimmed.startsWith(">=")) {
    const value = trimmed.slice(2).trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) >= ?`, params: [num] };
    }
  }
  if (trimmed.startsWith("<=")) {
    const value = trimmed.slice(2).trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) <= ?`, params: [num] };
    }
  }
  if (trimmed.startsWith("!=") || trimmed.startsWith("<>")) {
    const value = trimmed.slice(2).trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) != ?`, params: [num] };
    }
  }
  if (trimmed.startsWith(">")) {
    const value = trimmed.slice(1).trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) > ?`, params: [num] };
    }
  }
  if (trimmed.startsWith("<")) {
    const value = trimmed.slice(1).trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) < ?`, params: [num] };
    }
  }

  const rangeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:\.\.|to)\s*(\d+(?:\.\d+)?)$/i);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]!);
    const max = parseFloat(rangeMatch[2]!);
    if (!isNaN(min) && !isNaN(max)) {
      return { sql: `CAST(${columnIdent} AS DOUBLE) BETWEEN ? AND ?`, params: [min, max] };
    }
  }

  if (trimmed.includes("*") || trimmed.includes("?")) {
    const pattern = trimmed.replace(/\*/g, "%").replace(/\?/g, "_");
    return { sql: `LOWER(CAST(${columnIdent} AS VARCHAR)) LIKE LOWER(?)`, params: [pattern] };
  }

  return { sql: `LOWER(CAST(${columnIdent} AS VARCHAR)) LIKE LOWER(?)`, params: [`%${trimmed}%`] };
}

export function buildWhereClause(
  filters: Array<{ columnName: string; value: string; isNumeric?: boolean }>,
): SQLFilterResult {
  if (filters.length === 0) {
    return { sql: "", params: [] };
  }

  const conditions: string[] = [];
  const allParams: unknown[] = [];

  for (const filter of filters) {
    const { sql, params } = parseFilterToSQL(
      filter.columnName,
      filter.value,
      filter.isNumeric ?? false,
    );

    if (sql && sql !== "1=1") {
      conditions.push(sql);
      allParams.push(...params);
    }
  }

  if (conditions.length === 0) {
    return { sql: "", params: [] };
  }

  const sql = ` WHERE ${conditions.join(" AND ")}`;
  return { sql, params: allParams };
}
