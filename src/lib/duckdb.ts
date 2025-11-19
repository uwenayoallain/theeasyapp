import { Database, type Connection } from "duckdb";
import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { buildWhereClause } from "./filterPredicateSQL";
import { escapeIdentifier, escapeLiteral, isNumericType } from "./duckdb-utils";
import { isExcelFile, isCSVFile } from "./validators";
import { parseExcelFile } from "./excelParser";

const DEFAULT_TABLE = DEFAULT_DUCKDB_TABLE;
const SAMPLE_CSV = fileURLToPath(
  new URL("../data/sample.csv", import.meta.url),
);
const DB_FILE = Bun.env.DUCKDB_DATABASE ?? ":memory:";
const TEMP_DIR = Bun.env.DUCKDB_TMP_DIR ?? join(process.cwd(), ".duckdb-tmp");
const DUCKDB_THREADS = Number(Bun.env.DUCKDB_THREADS || "4");
const DUCKDB_MEMORY = Bun.env.DUCKDB_MEMORY || "1GB";
const DUCKDB_PRESERVE_INSERTION_ORDER =
  Bun.env.DUCKDB_PRESERVE_INSERTION_ORDER === "false" ? false : true;
const MAX_CONNECTIONS = Number(Bun.env.DUCKDB_MAX_CONNECTIONS || "3");

const database = new Database(DB_FILE);
const MAX_CHUNK_SIZE = 10000;

const connections: Connection[] = [];
let connectionIndex = 0;
let queue: Promise<unknown> = Promise.resolve();
let initPromise: Promise<void> | null = null;

const tableColumnsCache = new Map<string, DuckDBColumnMeta[]>();
const tableColumnsPending = new Map<string, Promise<DuckDBColumnMeta[]>>();
const tableRowCountCache = new Map<
  string,
  { count: number; timestamp: number }
>();
const ROW_COUNT_CACHE_TTL = 30000;

function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function getConnection(): Connection {
  if (connections.length === 0) {
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
      connections.push(database.connect());
    }
  }
  const conn = connections[connectionIndex % connections.length]!;
  connectionIndex = (connectionIndex + 1) % connections.length;
  return conn;
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

type DataSource =
  | { path: string; name?: string }
  | { url: string; name?: string }
  | { blob: Blob; name?: string };

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
    // Invalidate cached metadata for this table since schema may change
    tableColumnsCache.delete(tableName);
    tableColumnsPending.delete(tableName);
  });
}

export async function initDuckDB(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await enqueue(async (conn) => {
      await run(conn, `SET threads TO ${DUCKDB_THREADS}`);
      await run(conn, `SET memory_limit = '${DUCKDB_MEMORY}'`);
      await run(conn, "SET enable_progress_bar = true");
      await run(
        conn,
        "SET preserve_insertion_order = " +
          (DUCKDB_PRESERVE_INSERTION_ORDER ? "true" : "false"),
      );
      await run(conn, "SET enable_object_cache = true");
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
  const cached = tableColumnsCache.get(tableName);
  if (cached) return cached;
  const pending = tableColumnsPending.get(tableName);
  if (pending) return pending;

  const tableIdent = escapeIdentifier(tableName);
  const promise = enqueue(async (conn) => {
    const rows = await all<{ name: string; type: string }>(
      conn,
      `PRAGMA table_info(${tableIdent})`,
    );
    const cols = rows.map((row) => ({ name: row.name, type: row.type }));
    tableColumnsCache.set(tableName, cols);
    tableColumnsPending.delete(tableName);
    return cols;
  });
  tableColumnsPending.set(tableName, promise);
  return promise;
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
  const cached = tableRowCountCache.get(tableName);
  if (cached && Date.now() - cached.timestamp < ROW_COUNT_CACHE_TTL) {
    return cached.count;
  }

  const tableIdent = escapeIdentifier(tableName);
  return enqueue(async (conn) => {
    const rows = await all<{ count: number }>(
      conn,
      `SELECT COUNT(*) AS count FROM ${tableIdent}`,
    );
    const count = Number(rows[0]?.count ?? 0);
    tableRowCountCache.set(tableName, { count, timestamp: Date.now() });
    return count;
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

async function writeCSVToTempFileFromExcelBlob(blob: Blob): Promise<string> {
  // Parse Excel and write a temp CSV that DuckDB can ingest
  ensureTempDir();
  const { columns, rows } = await parseExcelFile(
    new File([await blob.arrayBuffer()], "upload.xlsx"),
  );
  const header = columns.map((c) => c.name.replace(/"/g, "")).join(",");
  const csvLines = [
    header,
    ...rows.map((r) =>
      r
        .map((cell) => String(cell ?? ""))
        .map((v) =>
          v.includes(",") || v.includes("\n") || v.includes('"')
            ? `"${v.replaceAll('"', '""')}"`
            : v,
        )
        .join(","),
    ),
  ];
  const tempPath = join(
    TEMP_DIR,
    `${Date.now()}-${Math.random().toString(16).slice(2)}.csv`,
  );
  await Bun.write(tempPath, csvLines.join("\n"));
  return tempPath;
}

export async function loadCsvFromSource(
  source: DataSource,
  tableName: string = DEFAULT_TABLE,
): Promise<{ columns: DuckDBColumnMeta[]; rowCount: number }> {
  let tempPath: string | null = null;
  try {
    if ("path" in source) {
      const isExcel = source.name
        ? isExcelFile(source.name)
        : isExcelFile(source.path);
      if (isExcel) {
        // Read path into blob then convert
        const file = Bun.file(source.path);
        const buf = await file.arrayBuffer();
        const csvPath = await writeCSVToTempFileFromExcelBlob(new Blob([buf]));
        tempPath = csvPath;
        await loadCsvIntoTable(csvPath, tableName);
      } else {
        await loadCsvIntoTable(source.path, tableName);
      }
    } else if ("blob" in source) {
      const extension = source.name
        ? isExcelFile(source.name)
          ? ".xlsx"
          : isCSVFile(source.name)
            ? ".csv"
            : ".csv"
        : ".csv";
      if (extension === ".xlsx") {
        const csvPath = await writeCSVToTempFileFromExcelBlob(source.blob);
        tempPath = csvPath;
        await loadCsvIntoTable(csvPath, tableName);
      } else {
        tempPath = await writeBlobToTempFile(source.blob, extension);
        await loadCsvIntoTable(tempPath, tableName);
      }
    } else if ("url" in source) {
      if (!isHttpUrl(source.url)) {
        throw new Error("Only http(s) URLs are supported");
      }
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV (${response.status})`);
      }
      const blob = await response.blob();
      const isExcel = source.name
        ? isExcelFile(source.name)
        : /\.xlsx?$/.test(new URL(source.url).pathname.toLowerCase());
      if (isExcel) {
        const csvPath = await writeCSVToTempFileFromExcelBlob(blob);
        tempPath = csvPath;
        await loadCsvIntoTable(csvPath, tableName);
      } else {
        tempPath = await writeBlobToTempFile(blob);
        await loadCsvIntoTable(tempPath, tableName);
      }
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

export async function listTables(): Promise<string[]> {
  return enqueue(async (conn) => {
    const rows = await all<{ name: string }>(conn, "SHOW TABLES");
    return rows
      .map((r) => String(r.name))
      .filter((n) => n && n.trim().length > 0);
  });
}

export async function getTableInfo(tableName: string = DEFAULT_TABLE): Promise<{
  name: string;
  columns: DuckDBColumnMeta[];
  rowCount: number;
}> {
  const columns = await getTableColumns(tableName);
  const rowCount = await getTableRowCount(tableName);
  return { name: tableName, columns, rowCount };
}

export async function loadMultipleSources(
  sources: Array<{ source: DataSource; table: string }>,
): Promise<
  Array<{ table: string; columns: DuckDBColumnMeta[]; rowCount: number }>
> {
  const results: Array<{
    table: string;
    columns: DuckDBColumnMeta[];
    rowCount: number;
  }> = [];
  for (const item of sources) {
    const res = await loadCsvFromSource(item.source, item.table);
    results.push({
      table: item.table,
      columns: res.columns,
      rowCount: res.rowCount,
    });
  }
  return results;
}

export async function dropTables(tables: string[]): Promise<number> {
  const unique = Array.from(new Set(tables.map((t) => t).filter(Boolean)));
  if (unique.length === 0) return 0;
  return enqueue(async (conn) => {
    await run(conn, "BEGIN TRANSACTION");
    try {
      for (const name of unique) {
        const ident = escapeIdentifier(name);
        await run(conn, `DROP TABLE IF EXISTS ${ident}`);
        // Invalidate cache entries
        tableColumnsCache.delete(name);
        tableColumnsPending.delete(name);
      }
      await run(conn, "COMMIT");
      return unique.length;
    } catch (error) {
      await run(conn, "ROLLBACK");
      throw error;
    }
  });
}
