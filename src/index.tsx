import { serve } from "bun";
import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";
import {
  getTableChunk,
  getTableColumns,
  getDistinctValues,
  initDuckDB,
  loadCsvFromSource,
  runQuery,
  updateTableCells,
  type DuckDBCellUpdate,
} from "@/lib/duckdb";
import { sanitizeTableName } from "@/lib/duckdb-utils";
import index from "./index.html";

async function buildWorker(
  workerName: "csv-worker" | "table-worker",
  entrypoint: string,
): Promise<Response> {
  try {
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
    console.error(`Failed to build ${workerName}:`, err);
    return new Response("// Worker build error\n", {
      status: 500,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
      },
    });
  }
}

const server = serve({
  port: 6969,
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
          let table = DEFAULT_DUCKDB_TABLE;
          let source:
            | { kind: "url"; url: string }
            | { kind: "blob"; blob: Blob }
            | null = null;

          if (contentType.includes("application/json")) {
            const payload = await request.json().catch(() => null);
            const url =
              typeof payload?.url === "string" ? payload.url.trim() : "";
            if (!url) {
              return Response.json(
                { error: "Request JSON must include url" },
                { status: 400 },
              );
            }
            table = sanitizeTableName(payload?.table);
            source = { kind: "url", url };
          } else if (contentType.includes("multipart/form-data")) {
            const form = await request.formData();
            table = sanitizeTableName(form.get("table"));
            const maybeFile = form.get("file");
            const maybeUrl = form.get("url");
            if (maybeFile instanceof File) {
              source = { kind: "blob", blob: maybeFile };
            } else if (
              typeof maybeUrl === "string" &&
              maybeUrl.trim().length > 0
            ) {
              source = { kind: "url", url: maybeUrl.trim() };
            } else {
              return Response.json(
                { error: "Provide a CSV file or url field." },
                { status: 400 },
              );
            }
          } else {
            return Response.json(
              { error: "Unsupported content type" },
              { status: 415 },
            );
          }

          if (!source) {
            return Response.json(
              { error: "No CSV source provided" },
              { status: 400 },
            );
          }

          const { columns, rowCount } =
            source.kind === "blob"
              ? await loadCsvFromSource({ blob: source.blob }, table)
              : await loadCsvFromSource({ url: source.url }, table);

          return Response.json({
            table,
            columns,
            rowCount,
          });
        } catch (error) {
          console.error("DuckDB load error:", error);
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "DuckDB load failed",
            },
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

          const filtersParam = url.searchParams.get("filters");
          const filters: Array<{ columnName: string; value: string }> = [];
          if (filtersParam) {
            try {
              const parsed = JSON.parse(filtersParam) as Record<string, string>;
              const tableColumns = await getTableColumns(table);
              for (const [colIndexStr, value] of Object.entries(parsed)) {
                const colIndex = Number.parseInt(colIndexStr, 10);
                if (Number.isFinite(colIndex) && tableColumns[colIndex]) {
                  filters.push({
                    columnName: tableColumns[colIndex]!.name,
                    value,
                  });
                }
              }
            } catch (error) {
              console.warn("Failed to parse filters param:", error);
            }
          }

          const sortParam = url.searchParams.get("sort");
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
              console.warn("Failed to parse sort param:", error);
            }
          }

          const chunk = await getTableChunk(
            table,
            offsetParam,
            limitParam,
            filters,
            sort,
          );
          return Response.json({
            table,
            offset: chunk.offset,
            limit: chunk.limit,
            rowCount: chunk.rowCount,
            columns: chunk.columns,
            rows: chunk.rows,
          });
        } catch (error) {
          console.error("DuckDB preview error:", error);
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "DuckDB preview failed",
            },
            { status: 500 },
          );
        }
      },
    },

    "/api/db/distinct-values": {
      async GET(request) {
        try {
          await initDuckDB();
          const url = new URL(request.url);
          const table = sanitizeTableName(url.searchParams.get("table"));
          const column = url.searchParams.get("column");
          const limitParam = Number.parseInt(
            url.searchParams.get("limit") ?? "100",
            10,
          );

          if (!column) {
            return Response.json(
              { error: "Column name is required" },
              { status: 400 },
            );
          }

          const limit =
            Number.isFinite(limitParam) && limitParam > 0
              ? Math.min(limitParam, 1000)
              : 100;

          const values = await getDistinctValues(table, column, limit);
          return Response.json({ values });
        } catch (error) {
          console.error("DuckDB distinct values error:", error);
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to get distinct values",
            },
            { status: 500 },
          );
        }
      },
    },

    "/api/db/query": {
      async POST(request) {
        try {
          await initDuckDB();
          const payload = await request.json().catch(() => null);
          const sql = typeof payload?.sql === "string" ? payload.sql : "";
          if (!sql.trim()) {
            return Response.json(
              { error: "SQL query is required" },
              { status: 400 },
            );
          }
          if (!/^\s*select/i.test(sql)) {
            return Response.json(
              { error: "Only SELECT queries are permitted" },
              { status: 400 },
            );
          }
          const params = Array.isArray(payload?.params) ? payload.params : [];
          const rows = await runQuery(sql, params);
          const columns = rows[0] ? Object.keys(rows[0] ?? {}) : [];
          return Response.json({ rows, columns });
        } catch (error) {
          console.error("DuckDB query error:", error);
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "DuckDB query failed",
            },
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
            return Response.json(
              { error: "No updates provided" },
              { status: 400 },
            );
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
              return Response.json(
                { error: "Invalid update payload" },
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
          return Response.json({ updated: applied });
        } catch (error) {
          console.error("DuckDB mutate error:", error);
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "DuckDB mutate failed",
            },
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

console.log(`🚀 Server running at ${server.url}`);
