import { serve } from "bun";
import { join } from "node:path";
import {
  getTableChunk,
  getTableColumns,
  initDuckDB,
  runQuery,
  updateTableCells,
  listTables,
  loadMultipleSources,
  getTableInfo,
  dropTables,
  type DuckDBCellUpdate,
} from "@/lib/duckdb";
import { sanitizeTableName } from "@/lib/duckdb-utils";
import { jsonResponse } from "@/lib/api-helpers";
import { responseCache } from "@/lib/response-cache";
import { TempCleanupService } from "@/lib/temp-cleanup";
import { logger } from "@/lib/logger";
import index from "./index.html";

const TEMP_DIR = Bun.env.DUCKDB_TMP_DIR ?? join(process.cwd(), ".duckdb-tmp");
const cleanupService = new TempCleanupService(TEMP_DIR);

if (process.env.NODE_ENV === "production") {
  cleanupService.start();
}

// Cache worker builds in-memory to avoid repeated Bun.build calls per request
// during development and when a prebuilt file is not available in production.
const workerCodeCache = new Map<string, string>();

async function buildWorker(
  workerName: "csv-worker" | "table-worker",
  entrypoint: string,
): Promise<Response> {
  try {
    // Serve prebuilt worker in production if available
    if (process.env.NODE_ENV === "production") {
      const matches = [
        ...new Bun.Glob(`dist/workers/${workerName}*.js`).scanSync(
          process.cwd(),
        ),
      ];
      const prebuilt = matches.find(Boolean);
      if (prebuilt) {
        return new Response(Bun.file(prebuilt), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }
    // Return cached code if present
    const cacheKey = `${process.env.NODE_ENV ?? "dev"}:${workerName}:${entrypoint}`;
    const cached = workerCodeCache.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control":
            process.env.NODE_ENV === "production"
              ? "public, max-age=31536000, immutable"
              : "no-store",
        },
      });
    }

    // Build on-demand and cache the result (dev and prod fallback)
    const build = await Bun.build({
      entrypoints: [entrypoint],
      target: "browser",
      format: "esm",
      minify: process.env.NODE_ENV === "production",
      sourcemap: process.env.NODE_ENV === "production" ? "linked" : "inline",
      splitting: false,
    });
    const out = build.outputs[0];
    if (!out) {
      throw new Error("Worker build produced no output");
    }
    const code = await out.text();
    // Cache built code; HMR will recreate this module and clear the cache
    workerCodeCache.set(cacheKey, code);
    return new Response(code, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control":
          process.env.NODE_ENV === "production"
            ? "public, max-age=31536000, immutable"
            : "no-store",
      },
    });
  } catch (err) {
    logger.error(`Failed to build ${workerName}:`, err);
    return new Response("// Worker build error\n", {
      status: 500,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
      },
    });
  }
}

function getMimeType(filePath: string): string {
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function serveCompressedStatic(
  request: Request,
): Promise<Response | null> {
  if (process.env.NODE_ENV !== "production") return null;

  const url = new URL(request.url);
  const acceptEncoding = request.headers.get("accept-encoding") ?? "";

  if (!url.pathname.startsWith("/dist/")) return null;

  const basePath = url.pathname.slice(1);

  if (acceptEncoding.includes("br")) {
    const brPath = `${basePath}.br`;
    const brFile = Bun.file(brPath);
    if (await brFile.exists()) {
      return new Response(brFile, {
        headers: {
          "Content-Encoding": "br",
          "Content-Type": getMimeType(basePath),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  if (acceptEncoding.includes("gzip")) {
    const gzPath = `${basePath}.gz`;
    const gzFile = Bun.file(gzPath);
    if (await gzFile.exists()) {
      return new Response(gzFile, {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": getMimeType(basePath),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return null;
}

const server = serve({
  port: 6969,
  async fetch(request) {
    if (process.env.NODE_ENV === "production") {
      const compressed = await serveCompressedStatic(request);
      if (compressed) return compressed;
    }

    return undefined as unknown as Response;
  },
  routes: {
    "/workers/csv-worker.js": {
      async GET() {
        return buildWorker("csv-worker", "./src/workers/csvWorker.ts");
      },
    },
    "/workers/table-worker.js": {
      async GET() {
        return buildWorker("table-worker", "./src/workers/tableWorker.ts");
      },
    },
    "/data/sample.csv": {
      async GET() {
        const file = Bun.file("./src/data/sample.csv");
        return new Response(file, {
          headers: { "Content-Type": "text/csv; charset=utf-8" },
        });
      },
    },
    "/api/db/load": {
      async POST(request) {
        try {
          await initDuckDB();
          const contentType = request.headers.get("content-type") ?? "";
          let results: Array<{
            table: string;
            columns: { name: string; type: string }[];
            rowCount: number;
          }> = [];

          if (contentType.includes("application/json")) {
            const payload = await request.json().catch(() => null);
            const urls: string[] = Array.isArray(payload?.urls)
              ? payload.urls
                  .map((u: unknown) => String(u))
                  .filter((u: string) => u && u.trim().length > 0)
              : [];
            const singleUrl =
              typeof payload?.url === "string" ? payload.url.trim() : "";
            const tablePrefix =
              typeof payload?.tablePrefix === "string"
                ? payload.tablePrefix
                : undefined;
            const tableName = sanitizeTableName(payload?.table);

            if (urls.length === 0 && !singleUrl) {
              return Response.json(
                { error: "Request JSON must include url or urls[]" },
                { status: 400 },
              );
            }

            const allUrls = [...urls, ...(singleUrl ? [singleUrl] : [])];
            const sources = allUrls.map((url, i) => {
              const nameFromUrl = (() => {
                try {
                  const u = new URL(url);
                  const last = u.pathname.split("/").pop() ?? "dataset.csv";
                  return last;
                } catch {
                  return `dataset_${i + 1}.csv`;
                }
              })();
              const table =
                allUrls.length === 1
                  ? tableName
                  : sanitizeTableName(`${tablePrefix ?? "t"}_${i + 1}`);
              return { source: { url, name: nameFromUrl }, table };
            });
            results = await loadMultipleSources(sources);
          } else if (contentType.includes("multipart/form-data")) {
            const form = await request.formData();
            const tablePrefixRaw = form.get("tablePrefix");
            const tablePrefix =
              typeof tablePrefixRaw === "string" && tablePrefixRaw
                ? tablePrefixRaw
                : undefined;
            const singleTable = sanitizeTableName(form.get("table"));

            const files: File[] = [];
            const fromFile = form.get("file");
            if (fromFile instanceof File) files.push(fromFile);
            for (const f of form.getAll("files")) {
              if (f instanceof File) files.push(f);
            }
            // Support repeated 'file' fields
            for (const f of form.getAll("file")) {
              if (f instanceof File) files.push(f);
            }

            const urls: string[] = [];
            const maybeUrl = form.get("url");
            if (typeof maybeUrl === "string" && maybeUrl.trim())
              urls.push(maybeUrl.trim());
            for (const u of form.getAll("url")) {
              if (typeof u === "string" && u.trim()) urls.push(u.trim());
            }
            const urlsCsv = form.get("urls");
            if (typeof urlsCsv === "string" && urlsCsv.trim()) {
              urls.push(
                ...urlsCsv
                  .split(/[,\n\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }

            if (files.length === 0 && urls.length === 0) {
              return Response.json(
                { error: "Provide one or more files (file/files) or url/urls" },
                { status: 400 },
              );
            }

            const fileSources = files.map((file, i) => {
              const table =
                files.length === 1 && urls.length === 0
                  ? singleTable
                  : sanitizeTableName(`${tablePrefix ?? "t"}_${i + 1}`);
              return {
                source: { blob: file, name: file.name },
                table,
              } as const;
            });
            const urlSources = urls.map((u, i) => {
              const nameFromUrl = (() => {
                try {
                  const parsed = new URL(u);
                  return (
                    parsed.pathname.split("/").pop() ?? `dataset_${i + 1}.csv`
                  );
                } catch {
                  return `dataset_${i + 1}.csv`;
                }
              })();
              const table =
                urls.length === 1 && files.length === 0
                  ? singleTable
                  : sanitizeTableName(
                      `${tablePrefix ?? "t"}_${files.length + i + 1}`,
                    );
              return { source: { url: u, name: nameFromUrl }, table } as const;
            });

            results = await loadMultipleSources([
              ...fileSources,
              ...urlSources,
            ]);
          } else {
            return Response.json(
              { error: "Unsupported content type" },
              { status: 415 },
            );
          }

          if (results.length === 1) {
            const only = results[0]!;
            return jsonResponse(
              {
                table: only.table,
                columns: only.columns,
                rowCount: only.rowCount,
              },
              request,
            );
          }
          return jsonResponse({ loaded: results }, request);
        } catch (error) {
          logger.error("DuckDB load error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error ? error.message : "DuckDB load failed",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    "/api/db/tables": {
      async GET(request) {
        try {
          await initDuckDB();
          const names = await listTables();
          const details = await Promise.all(
            names.map((n) =>
              getTableInfo(n).catch(() => ({
                name: n,
                columns: [],
                rowCount: 0,
              })),
            ),
          );
          return jsonResponse({ tables: details }, request);
        } catch (error) {
          logger.error("DuckDB list tables error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to list tables",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    "/api/db/drop": {
      async POST(request) {
        try {
          await initDuckDB();
          const payload = await request.json().catch(() => null);
          const tablesRaw = payload?.tables ?? payload?.table;
          const tables: string[] = Array.isArray(tablesRaw)
            ? tablesRaw.map((t: unknown) => String(t)).filter(Boolean)
            : typeof tablesRaw === "string"
              ? [tablesRaw]
              : [];
          if (tables.length === 0) {
            return jsonResponse(
              { error: "Provide table or tables[] to drop" },
              request,
              { status: 400 },
            );
          }
          const count = await dropTables(tables);
          return jsonResponse({ dropped: count }, request);
        } catch (error) {
          logger.error("DuckDB drop tables error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to drop tables",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    "/api/db/preview": {
      async GET(request) {
        try {
          await initDuckDB();
          const url = new URL(request.url);
          const table = sanitizeTableName(url.searchParams.get("table"));
          const offsetParam = Number.parseInt(
            url.searchParams.get("offset") ?? "0",
            10,
          );
          const limitParam = Number.parseInt(
            url.searchParams.get("limit") ?? "2000",
            10,
          );

          const sortParam = url.searchParams.get("sort");
          const cacheKey = `preview:${table}:${offsetParam}:${limitParam}:${sortParam ?? ""}`;
          const ifNoneMatch = request.headers.get("if-none-match");

          if (ifNoneMatch) {
            const matches = responseCache.checkETag(cacheKey, ifNoneMatch);
            if (matches) {
              return new Response(null, {
                status: 304,
                headers: {
                  "Cache-Control": "private, max-age=60",
                  ETag: ifNoneMatch,
                },
              });
            }
          }

          const cached = responseCache.get(cacheKey);
          if (cached) {
            return jsonResponse(cached.data, request, {
              headers: {
                "Cache-Control": "private, max-age=60",
                ETag: cached.etag,
              },
            });
          }

          // Filters disabled for now
          const filters: Array<{ columnName: string; value: string }> = [];

          let sort:
            | { columnName: string; direction: "asc" | "desc" }
            | undefined;
          if (sortParam) {
            try {
              const parsed = JSON.parse(sortParam) as {
                colIndex: number;
                dir: string;
              };
              const tableColumns = await getTableColumns(table);
              if (
                Number.isFinite(parsed.colIndex) &&
                tableColumns[parsed.colIndex]
              ) {
                sort = {
                  columnName: tableColumns[parsed.colIndex]!.name,
                  direction: parsed.dir === "desc" ? "desc" : "asc",
                };
              }
            } catch (error) {
              logger.warn("Failed to parse sort param:", error);
            }
          }

          const chunk = await getTableChunk(
            table,
            offsetParam,
            limitParam,
            filters,
            sort,
          );

          const responseData = {
            table,
            offset: chunk.offset,
            limit: chunk.limit,
            rowCount: chunk.rowCount,
            columns: chunk.columns,
            rows: chunk.rows,
          };

          const etag = responseCache.set(cacheKey, responseData);

          return jsonResponse(responseData, request, {
            headers: {
              "Cache-Control": "private, max-age=60",
              ETag: etag,
            },
          });
        } catch (error) {
          logger.error("DuckDB preview error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "DuckDB preview failed",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    // Distinct-values API removed (filters disabled)

    "/api/db/query": {
      async POST(request) {
        try {
          await initDuckDB();
          const payload = await request.json().catch(() => null);
          const sql = typeof payload?.sql === "string" ? payload.sql : "";
          if (!sql.trim()) {
            return jsonResponse({ error: "SQL query is required" }, request, {
              status: 400,
            });
          }
          if (!/^\s*select/i.test(sql)) {
            return jsonResponse(
              { error: "Only SELECT queries are permitted" },
              request,
              { status: 400 },
            );
          }
          const params = Array.isArray(payload?.params) ? payload.params : [];
          const rows = await runQuery(sql, params);
          const columns = rows[0] ? Object.keys(rows[0] ?? {}) : [];
          return jsonResponse({ rows, columns }, request);
        } catch (error) {
          logger.error("DuckDB query error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error ? error.message : "DuckDB query failed",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    "/api/db/mutate": {
      async POST(request) {
        try {
          await initDuckDB();
          const payload = await request.json().catch(() => null);
          const updates = Array.isArray(payload?.updates)
            ? payload.updates
            : [];
          if (updates.length === 0) {
            return jsonResponse({ error: "No updates provided" }, request, {
              status: 400,
            });
          }
          const table = sanitizeTableName(payload?.table);
          const normalized: DuckDBCellUpdate[] = [];
          for (const entry of updates) {
            if (
              typeof entry?.rowIndex !== "number" ||
              !Number.isFinite(entry.rowIndex) ||
              entry.rowIndex < 0 ||
              typeof entry?.column !== "string" ||
              entry.column.length === 0
            ) {
              return jsonResponse(
                { error: "Invalid update payload" },
                request,
                { status: 400 },
              );
            }
            normalized.push({
              rowIndex: Math.floor(entry.rowIndex),
              column: entry.column,
              value:
                typeof entry.value === "string"
                  ? entry.value
                  : String(entry.value ?? ""),
            });
          }
          const applied = await updateTableCells(normalized, table);
          responseCache.invalidate(`preview:${table}:`);
          return jsonResponse({ updated: applied }, request);
        } catch (error) {
          logger.error("DuckDB mutate error:", error);
          return jsonResponse(
            {
              error:
                error instanceof Error ? error.message : "DuckDB mutate failed",
            },
            request,
            { status: 500 },
          );
        }
      },
    },

    "/api/hello": {
      async GET() {
        return Response.json({ message: "Hello, world!", method: "GET" });
      },
      async PUT() {
        return Response.json({ message: "Hello, world!", method: "PUT" });
      },
    },

    "/api/hello/:name": {
      async GET(req) {
        return Response.json({ message: `Hello, ${req.params.name}!` });
      },
    },

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,

    console: true,
  },
});

if (process.env.NODE_ENV !== "production") {
  logger.log(`?? Server running at ${server.url}`);
}
