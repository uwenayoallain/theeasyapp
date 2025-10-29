import { Database, type Connection } from "duckdb";
import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { buildWhereClause } from "./filterPredicateSQL";
import { escapeIdentifier, escapeLiteral, isNumericType } from "./duckdb-utils";

const DEFAULT_TABLE = DEFAULT_DUCKDB_TABLE;
const SAMPLE_CSV = fileURLToPath(
  new URL("../data/sample.csv", import.meta.url),
);
const DB_FILE = Bun.env.DUCKDB_DATABASE ?? ":memory:";
const TEMP_DIR = Bun.env.DUCKDB_TMP_DIR ?? join(process.cwd(), ".duckdb-tmp");
const DUCKDB_THREADS = Number(Bun.env.DUCKDB_THREADS || "4");
const DUCKDB_MEMORY = Bun.env.DUCKDB_MEMORY || "1GB";

const database = new Database(DB_FILE);
const MAX_CHUNK_SIZE = 10000;

let connection: Connection | null = null;
let queue: Promise<unknown> = Promise.resolve();
let initPromise: Promise<void> | null = null;

function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function getConnection(): Connection {
  if (!connection) {
    connection = database.connect();
  }
  return connection;
}

function enqueue<T>(task: (conn: Connection) => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    return task(getConnection());
  });
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function run(
  conn: Connection,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null) => (err ? reject(err) : resolve());
    if (params.length > 0) {
      conn.run(sql, ...params, cb);
    } else {
      conn.run(sql, cb);
    }
  });
}

function all<T>(
  conn: Connection,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, rows: unknown[]) =>
      err ? reject(err) : resolve(rows as T[]);
    if (params.length > 0) {
      conn.all(sql, ...params, cb);
    } else {
      conn.all(sql, cb);
    }
  });
}

function resolveCsvPath(csvPath: string): string {
  if (!csvPath) throw new Error("CSV path is required");
  if (csvPath.startsWith("file:")) return fileURLToPath(csvPath);
  return isAbsolute(csvPath) ? csvPath : join(process.cwd(), csvPath);
}

async function ensureCsvExists(csvPath: string) {
  if (!existsSync(csvPath)) {
    throw new Error(`CSV not found at ${csvPath}`);
  }
}

export interface DuckDBColumnMeta {
  name: string;
  type: string;
}

export interface DuckDBTableChunk {
  columns: DuckDBColumnMeta[];
  rows: string[][];
  rowCount: number;
  offset: number;
  limit: number;
}

type CsvSource = { path: string } | { url: string } | { blob: Blob };

export interface DuckDBCellUpdate {
  rowIndex: number;
  column: string;
  value: string;
}

export async function loadCsvIntoTable(
  csvPath: string,
  tableName: string = DEFAULT_TABLE,
): Promise<void> {
  const resolved = resolveCsvPath(csvPath);
  await ensureCsvExists(resolved);
  const tableIdent = escapeIdentifier(tableName);
  const csvLiteral = escapeLiteral(resolved);

  await enqueue(async (conn) => {
    await run(
      conn,
      `CREATE OR REPLACE TABLE ${tableIdent} AS SELECT * FROM read_csv_auto('${csvLiteral}', HEADER=TRUE)`,
    );
  });
}

export async function initDuckDB(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await enqueue(async (conn) => {
      await run(conn, `SET threads TO ${DUCKDB_THREADS}`);
      await run(conn, `SET memory_limit = '${DUCKDB_MEMORY}'`);
      await run(conn, "SET enable_progress_bar = true");
    });

    await loadCsvIntoTable(SAMPLE_CSV);
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

export async function getTableColumns(
  tableName: string = DEFAULT_TABLE,
): Promise<DuckDBColumnMeta[]> {
  const tableIdent = escapeIdentifier(tableName);
  return enqueue(async (conn) => {
    const rows = await all<{ name: string; type: string }>(
      conn,
      `PRAGMA table_info(${tableIdent})`,
    );
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
    }));
  });
}

export async function getDistinctValues(
  tableName: string = DEFAULT_TABLE,
  columnName: string,
  limit: number = 100,
): Promise<string[]> {
  const tableIdent = escapeIdentifier(tableName);
  const columnIdent = escapeIdentifier(columnName);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);

  return enqueue(async (conn) => {
    // Get most frequent distinct values (useful for autocomplete)
    const rows = await all<{ value: string }>(
      conn,
      `SELECT CAST(${columnIdent} AS VARCHAR) AS value, COUNT(*) AS freq
       FROM ${tableIdent}
       WHERE ${columnIdent} IS NOT NULL AND CAST(${columnIdent} AS VARCHAR) != ''
       GROUP BY ${columnIdent}
       ORDER BY freq DESC, value ASC
       LIMIT ?`,
      [safeLimit],
    );
    return rows.map((row) => row.value);
  });
}

export async function getTableRowCount(
  tableName: string = DEFAULT_TABLE,
): Promise<number> {
  const tableIdent = escapeIdentifier(tableName);
  return enqueue(async (conn) => {
    const rows = await all<{ count: number }>(
      conn,
      `SELECT COUNT(*) AS count FROM ${tableIdent}`,
    );
    return Number(rows[0]?.count ?? 0);
  });
}

export interface DuckDBFilter {
  columnName: string;
  value: string;
}

export interface DuckDBSort {
  columnName: string;
  direction: "asc" | "desc";
}

export async function getTableChunk(
  tableName: string = DEFAULT_TABLE,
  offset: number = 0,
  limit: number = 2000,
  filters: DuckDBFilter[] = [],
  sort?: DuckDBSort,
): Promise<DuckDBTableChunk> {
  const tableIdent = escapeIdentifier(tableName);
  const safeOffset =
    Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), MAX_CHUNK_SIZE)
      : 2000;
  return enqueue(async (conn) => {
    // Get column metadata (with types for numeric detection)
    const columnRows = await all<{ name: string; type: string }>(
      conn,
      `PRAGMA table_info(${tableIdent})`,
    );
    const columns = columnRows.map((row) => ({
      name: row.name,
      type: row.type,
    }));

    // Build WHERE clause using advanced filter predicate parser
    const filterConditions = filters
      .map((filter) => {
        const column = columns.find((c) => c.name === filter.columnName);
        return {
          columnName: filter.columnName,
          value: filter.value,
          isNumeric: column ? isNumericType(column.type) : false,
        };
      })
      .filter((f) => f.value.trim() !== "");

    const { sql: whereClause, params } = buildWhereClause(filterConditions);

    // Build ORDER BY clause
    let orderByClause = "";
    if (sort) {
      const sortColumnIdent = escapeIdentifier(sort.columnName);
      const direction = sort.direction === "desc" ? "DESC" : "ASC";
      orderByClause = ` ORDER BY ${sortColumnIdent} ${direction}`;
    }

    // OPTIMIZATION: Use COUNT() OVER() to get total count in same query
    // This reduces two queries to one!
    const columnsList = columns.map((c) => escapeIdentifier(c.name)).join(", ");
    const sql = `
      SELECT ${columnsList}, COUNT(*) OVER() as _total_count
      FROM ${tableIdent}${whereClause}${orderByClause}
      LIMIT ? OFFSET ?
    `;

    const dataRows = await all<Record<string, unknown>>(conn, sql, [
      ...params,
      safeLimit,
      safeOffset,
    ]);

    // Extract total count from first row
    const rowCount =
      dataRows.length > 0 ? Number(dataRows[0]?._total_count ?? 0) : 0;

    // Convert rows to string arrays (remove _total_count)
    const rows = dataRows.map((row) =>
      columns.map(({ name }) => {
        const value = row[name];
        if (value == null) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }),
    );

    return { columns, rows, rowCount, offset: safeOffset, limit: safeLimit };
  });
}

export async function runQuery<
  T extends Record<string, unknown> = Record<string, unknown>,
>(sql: string, params: unknown[] = []): Promise<T[]> {
  return enqueue(async (conn) => all<T>(conn, sql, params));
}

export const duckdbConstants = {
  DEFAULT_TABLE,
};

export async function updateTableCells(
  updates: DuckDBCellUpdate[],
  tableName: string = DEFAULT_TABLE,
): Promise<number> {
  if (updates.length === 0) return 0;
  const tableIdent = escapeIdentifier(tableName);
  return enqueue(async (conn) => {
    await run(conn, "BEGIN TRANSACTION");
    try {
      for (const update of updates) {
        const columnIdent = escapeIdentifier(update.column);
        const rowId = update.rowIndex;
        await run(
          conn,
          `UPDATE ${tableIdent} SET ${columnIdent} = ? WHERE rowid = ?`,
          [update.value, rowId],
        );
      }
      await run(conn, "COMMIT");
      return updates.length;
    } catch (error) {
      await run(conn, "ROLLBACK");
      throw error;
    }
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function writeBlobToTempFile(
  blob: Blob,
  extension = ".csv",
): Promise<string> {
  ensureTempDir();
  const tempPath = join(
    TEMP_DIR,
    `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`,
  );
  const buffer = await blob.arrayBuffer();
  await Bun.write(tempPath, buffer);
  return tempPath;
}

export async function loadCsvFromSource(
  source: CsvSource,
  tableName: string = DEFAULT_TABLE,
): Promise<{ columns: DuckDBColumnMeta[]; rowCount: number }> {
  let tempPath: string | null = null;
  try {
    if ("path" in source) {
      await loadCsvIntoTable(source.path, tableName);
    } else if ("blob" in source) {
      tempPath = await writeBlobToTempFile(source.blob);
      await loadCsvIntoTable(tempPath, tableName);
    } else if ("url" in source) {
      if (!isHttpUrl(source.url)) {
        throw new Error("Only http(s) URLs are supported");
      }
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV (${response.status})`);
      }
      const blob = await response.blob();
      tempPath = await writeBlobToTempFile(blob);
      await loadCsvIntoTable(tempPath, tableName);
    } else {
      throw new Error("Unsupported CSV source");
    }

    const columns = await getTableColumns(tableName);
    const rowCount = await getTableRowCount(tableName);
    return { columns, rowCount };
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}
