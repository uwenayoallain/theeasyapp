import { useState, useCallback, useRef, useEffect } from "react";
import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";
import type { ColumnDef } from "@/lib/csv";
import { fetchAndParseCSV, parseCSVFile } from "@/lib/csvParser";
import { parseExcelFile } from "@/lib/excelParser";
import { isExcelFile } from "@/lib/validators";
import { csvEvent } from "@/lib/perf";
import { useToast } from "@/components/ui/toast-provider";
import { sanitizeTableName } from "@/lib/duckdb-utils";

const MAX_BUFFER_SIZE = 10000;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const WARN_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "",
];

function createWorker(path: string, fallbackName: string): Worker | null {
  try {
    return new Worker(path, { type: "module" });
  } catch (error) {
    console.warn(`${fallbackName} worker unavailable:`, error);
    return null;
  }
}

const csvWorkerFactory = () => createWorker("/workers/csv-worker.js", "CSV");
const tableWorkerFactory = () => createWorker("/workers/table-worker.js", "DuckDB table");

type DuckDBSource = {
  type: "duckdb";
  table?: string;
  batchSize?: number;
  url?: string;
  file?: File;
};

type CSVSource = {
  type?: "csv";
  url?: string;
  file?: File;
};

type LoadSource = DuckDBSource | CSVSource;

type TableWorkerColumn = { name: string; type: string };

type TableWorkerResponse =
  | { type: "ready"; columns?: TableWorkerColumn[]; rowCount?: number }
  | {
      type: "rows";
      requestId: number;
      rows: Array<{ index: number; values: string[] }>;
      rowCount?: number;
      columns?: TableWorkerColumn[];
    }
  | { type: "error"; requestId?: number; message: string };

type CsvWorkerColumnsMessage = { type: "columns"; columns: string[] };
type CsvWorkerRowsMessage = { type: "rows"; rows: string[][]; id?: number };
type CsvWorkerProgressMessage = {
  type: "progress";
  loaded?: number;
  total?: number;
};
type CsvWorkerDoneMessage = { type: "done" };
type CsvWorkerAbortedMessage = { type: "aborted" };
type CsvWorkerErrorMessage = { type: "error"; message: string };

type CsvWorkerMessage =
  | CsvWorkerColumnsMessage
  | CsvWorkerRowsMessage
  | CsvWorkerProgressMessage
  | CsvWorkerDoneMessage
  | CsvWorkerAbortedMessage
  | CsvWorkerErrorMessage;

type MutatePayload = {
  table: string;
  updates: Array<{ rowIndex: number; column: string; value: string }>;
};

const mutateTable = async (payload: MutatePayload) => {
  const response = await fetch("/api/db/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `DuckDB mutation failed (${response.status})`);
  }
};

export interface CSVLoaderState {
  columns: ColumnDef[];
  rows: string[][];
  progress: { loaded: number; total?: number; unit?: "bytes" | "rows" };
  isLoading: boolean;
  error: string | null;
  rowCount: number;
  isChunked: boolean;
  loadedRowIndices: number[];
}

export function useCSVLoader() {
  const [state, setState] = useState<CSVLoaderState>({
    columns: [],
    rows: [],
    progress: { loaded: 0, unit: "bytes" },
    isLoading: false,
    error: null,
    rowCount: 0,
    isChunked: false,
    loadedRowIndices: [],
  });
  useEffect(() => {
    columnsRef.current = state.columns;
  }, [state.columns]);
  const { showToast } = useToast();
  const workerRef = useRef<Worker | null>(null);
  const duckdbAbortRef = useRef<AbortController | null>(null);
  const duckdbClientRef = useRef<{
    worker: Worker;
    chunkSize: number;
    table: string;
    nextRequestId: number;
    pending: Map<
      number,
      { resolve: () => void; reject: (error: unknown) => void }
    >;
  } | null>(null);
  const duckdbLoadedRowsRef = useRef<Set<number>>(new Set());
  const duckdbTableRef = useRef<string>(DEFAULT_DUCKDB_TABLE);
  const columnsRef = useRef<ColumnDef[]>([]);
  const ensureRangeRef = useRef<
    ((start: number, end: number) => Promise<void>) | null
  >(null);
  const streamingStateRef = useRef<{
    rowsBuffer: string[][];
    flushScheduled: boolean;
    rafId: number | null;
    pendingBatchId: number | null;
    isPaused: boolean;
  } | null>(null);

  const persistDuckDBUpdates = useCallback(
    async (
      mutations: Array<{ rowIndex: number; colIndex: number; value: string }>,
    ) => {
      if (!duckdbClientRef.current || mutations.length === 0) return;
      const columns = columnsRef.current;
      const table = duckdbTableRef.current;
      const updates = mutations
        .map(({ rowIndex, colIndex, value }) => {
          const columnName = columns[colIndex]?.name;
          if (!columnName) return null;
          return { rowIndex, column: columnName, value };
        })
        .filter(
          (
            update,
          ): update is { rowIndex: number; column: string; value: string } =>
            update !== null,
        );
      if (updates.length === 0) return;
      await mutateTable({ table, updates });
      const affectedRows = updates.map((update) => update.rowIndex);
      duckdbClientRef.current.worker.postMessage({
        type: "invalidate",
        rows: affectedRows,
      });
      affectedRows.forEach((row) => duckdbLoadedRowsRef.current.delete(row));
      if (ensureRangeRef.current) {
        const min = Math.min(...affectedRows);
        const max = Math.max(...affectedRows);
        await ensureRangeRef.current(Math.max(0, min), max);
      }
    },
    [],
  );

  const cleanupWorker = useCallback((worker: Worker | null) => {
    if (!worker) return;
    try {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    } catch (error) {
      console.warn("useCSVLoader: failed to cleanup worker", error);
    }
  }, []);

  const flushStreamingRows = useCallback(() => {
    const streamingState = streamingStateRef.current;
    if (!streamingState) return;
    if (streamingState.rafId != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(streamingState.rafId);
      streamingState.rafId = null;
    }
    streamingState.flushScheduled = false;
    if (streamingState.rowsBuffer.length > 0) {
      const t0 = performance.now();
      const rowsChunk = streamingState.rowsBuffer.splice(
        0,
        streamingState.rowsBuffer.length,
      );
      setState((prev) => ({
        ...prev,
        rows: prev.rows.length === 0 ? rowsChunk : prev.rows.concat(rowsChunk),
        rowCount:
          prev.rows.length === 0
            ? rowsChunk.length
            : prev.rows.length + rowsChunk.length,
        isChunked: false,
      }));
      const dt = performance.now() - t0;
      csvEvent("flush", { ms: dt, rows: rowsChunk.length });
    }
    if (streamingState.pendingBatchId != null && workerRef.current) {
      workerRef.current.postMessage({
        type: "ack",
        id: streamingState.pendingBatchId,
      });
      streamingState.pendingBatchId = null;
    }
    if (
      streamingState.isPaused &&
      workerRef.current &&
      streamingState.rowsBuffer.length < MAX_BUFFER_SIZE / 2
    ) {
      workerRef.current.postMessage({ type: "resume" });
      streamingState.isPaused = false;
    }
  }, []);

  const loadSource = useCallback(
    async (source: LoadSource) => {
      const isDuckDB = source.type === "duckdb";
      const progressUnit: "bytes" | "rows" = isDuckDB ? "rows" : "bytes";

      // OPTIMIZATION: Force DuckDB for large files (>5MB) or Excel files
      if (!isDuckDB && source.file) {
        const FORCE_DUCKDB_SIZE = 5 * 1024 * 1024; // 5MB
        const isExcel = isExcelFile(source.file.name);

        if (source.file.size > FORCE_DUCKDB_SIZE || isExcel) {
          const reason = isExcel
            ? "Excel files"
            : `Files larger than ${(FORCE_DUCKDB_SIZE / 1024 / 1024).toFixed(0)}MB`;
          showToast({
            title: "Using database mode",
            description: `${reason} are automatically loaded into DuckDB for better performance.`,
          });

          // Convert to DuckDB source
          return loadSource({ type: "duckdb", file: source.file });
        }
      }

      if (!isDuckDB && source.file) {
        const fileSizeMb = (source.file.size / 1024 / 1024).toFixed(1);
        if (source.file.size > MAX_FILE_SIZE) {
          setState({
            columns: [],
            rows: [],
            progress: { loaded: 0, unit: progressUnit },
            isLoading: false,
            error: `File too large: ${fileSizeMb}MB (maximum: 500MB)`,
            rowCount: 0,
            isChunked: false,
            loadedRowIndices: [],
          });
          return;
        }
        if (
          source.file.type &&
          !ALLOWED_MIME_TYPES.includes(source.file.type)
        ) {
          const ext = source.file.name.split(".").pop()?.toLowerCase();
          const isSupportedByExtension =
            ext === "csv" ||
            ext === "tsv" ||
            ext === "xlsx" ||
            ext === "xls";

          if (!isSupportedByExtension) {
            setState({
              columns: [],
              rows: [],
              progress: { loaded: 0, unit: progressUnit },
              isLoading: false,
              error: `Unsupported file type: ${source.file.type}. Supported formats: CSV, TSV, Excel (.xlsx, .xls)`,
              rowCount: 0,
              isChunked: false,
              loadedRowIndices: [],
            });
            return;
          }
        }
        if (source.file.size > WARN_FILE_SIZE) {
          showToast({
            title: "Large file detected",
            description: `${fileSizeMb}MB CSVs can take longer to import.`,
          });
        }
      }

      if (!isDuckDB && source.url) {
        const trimmedUrl = source.url.trim();
        if (trimmedUrl && !trimmedUrl.match(/^https?:\/\//i)) {
          setState({
            columns: [],
            rows: [],
            progress: { loaded: 0, unit: progressUnit },
            isLoading: false,
            error: `Invalid URL protocol. Only HTTP and HTTPS are supported.`,
            rowCount: 0,
            isChunked: false,
            loadedRowIndices: [],
          });
          return;
        }
      }

      setState({
        columns: [],
        rows: [],
        progress: { loaded: 0, unit: progressUnit },
        isLoading: true,
        error: null,
        rowCount: 0,
        isChunked: isDuckDB,
        loadedRowIndices: [],
      });

      if (workerRef.current) {
        cleanupWorker(workerRef.current);
        workerRef.current = null;
      }

      if (
        streamingStateRef.current?.rafId != null &&
        typeof window !== "undefined"
      ) {
        window.cancelAnimationFrame(streamingStateRef.current.rafId);
      }
      streamingStateRef.current = null;

      if (duckdbAbortRef.current) {
        duckdbAbortRef.current.abort();
        duckdbAbortRef.current = null;
      }

      if (duckdbClientRef.current) {
        cleanupWorker(duckdbClientRef.current.worker);
        duckdbClientRef.current = null;
      }

      duckdbLoadedRowsRef.current = new Set();
      ensureRangeRef.current = null;

      if (isDuckDB) {
        const duckdbSource = source as DuckDBSource;
        const table = sanitizeTableName(duckdbSource.table);
        duckdbTableRef.current = table;
        const datasetUrl =
          typeof duckdbSource.url === "string" ? duckdbSource.url.trim() : undefined;
        const file = duckdbSource.file;
        const chunkSize =
          duckdbSource.batchSize && duckdbSource.batchSize > 0
            ? Math.floor(duckdbSource.batchSize)
            : 2000;
        const worker = tableWorkerFactory();

        if (!worker) {
          setState((prev) => ({
            ...prev,
            error: "DuckDB table worker unavailable",
            isLoading: false,
            isChunked: false,
          }));
          return;
        }

        const client = {
          worker,
          chunkSize,
          table,
          nextRequestId: 1,
          pending: new Map<
            number,
            { resolve: () => void; reject: (error: unknown) => void }
          >(),
        };
        duckdbClientRef.current = client;
        duckdbTableRef.current = table;
        duckdbLoadedRowsRef.current = new Set();

        worker.onerror = (event: ErrorEvent) => {
          console.error(
            "DuckDB table worker error:",
            event.error ?? event.message,
          );
          setState((prev) => ({
            ...prev,
            error: "DuckDB table worker crashed",
            isLoading: false,
          }));
        };

        worker.onmessage = (event: MessageEvent<TableWorkerResponse>) => {
          const data = event.data;
          const active = duckdbClientRef.current;
          if (!data || !active) return;

          switch (data.type) {
            case "ready": {
              if (
                (data.columns && data.columns.length > 0) ||
                typeof data.rowCount === "number"
              ) {
                setState((prev) => ({
                  ...prev,
                  columns:
                    data.columns && data.columns.length > 0
                      ? data.columns.map((col) => ({
                          name: col.name,
                          dataType: col.type,
                        }))
                      : prev.columns,
                  rowCount:
                    typeof data.rowCount === "number" &&
                    Number.isFinite(data.rowCount)
                      ? data.rowCount
                      : prev.rowCount,
                  isChunked: true,
                }));
              }
              break;
            }
            case "rows": {
              const pending = active.pending.get(data.requestId);
              if (pending) active.pending.delete(data.requestId);
              const hasPending = active.pending.size > 0;

              setState((prev) => {
                const incomingColumns =
                  data.columns && data.columns.length > 0
                    ? data.columns.map((col) => ({
                        name: col.name,
                        dataType: col.type,
                      }))
                    : prev.columns;
                const previousRowCount =
                  prev.rowCount > 0 ? prev.rowCount : prev.rows.length;
                const reportedRowCount =
                  typeof data.rowCount === "number" &&
                  Number.isFinite(data.rowCount)
                    ? data.rowCount
                    : previousRowCount;
                const highestIndex =
                  data.rows.length > 0
                    ? data.rows.reduce(
                        (max, row) => Math.max(max, row.index + 1),
                        0,
                      )
                    : 0;
                const resolvedRowCount = Math.max(
                  reportedRowCount,
                  highestIndex,
                );

                const rowCountChanged =
                  Math.abs(previousRowCount - resolvedRowCount) > 0;
                const nextRows = rowCountChanged
                  ? Array(resolvedRowCount)
                  : prev.rows.slice();
                if (!rowCountChanged && nextRows.length < resolvedRowCount) {
                  nextRows.length = resolvedRowCount;
                }

                const loadedRows = duckdbLoadedRowsRef.current;
                const newlyLoaded: number[] = [];
                for (const entry of data.rows) {
                  if (entry.index < 0 || entry.index >= resolvedRowCount)
                    continue;
                  const wasLoaded = loadedRows.has(entry.index);
                  nextRows[entry.index] = entry.values ?? ([] as string[]);
                  loadedRows.add(entry.index);
                  if (!wasLoaded) newlyLoaded.push(entry.index);
                }
                const nextLoadedRowIndices =
                  newlyLoaded.length > 0
                    ? [...prev.loadedRowIndices, ...newlyLoaded].sort(
                        (a, b) => a - b,
                      )
                    : prev.loadedRowIndices;

                const allRowsLoaded =
                  loadedRows.size >= resolvedRowCount && resolvedRowCount > 0;
                const shouldBeChunked = !allRowsLoaded;

                return {
                  ...prev,
                  columns: incomingColumns,
                  rows: nextRows,
                  rowCount: resolvedRowCount,
                  progress: {
                    loaded: Math.min(loadedRows.size, resolvedRowCount),
                    total: resolvedRowCount,
                    unit: "rows",
                  },
                  isLoading: hasPending,
                  isChunked: shouldBeChunked,
                  loadedRowIndices: nextLoadedRowIndices,
                };
              });

              if (pending) pending.resolve();
              break;
            }
            case "error": {
              const message = data.message ?? "DuckDB worker error";
              if (data.requestId) {
                const pending = active.pending.get(data.requestId);
                if (pending) {
                  active.pending.delete(data.requestId);
                  pending.reject(new Error(message));
                }
              }
              setState((prev) => ({
                ...prev,
                error: message,
                isLoading: false,
              }));
              break;
            }
          }
        };

        let initialColumnsMeta: TableWorkerColumn[] | undefined;
        let initialRowCount: number | undefined;

        if (datasetUrl || file) {
          const controller = new AbortController();
          duckdbAbortRef.current = controller;
          try {
            let response: Response;
            if (file) {
              const form = new FormData();
              form.append("table", table);
              form.append("file", file, file.name);
              if (datasetUrl) form.append("url", datasetUrl);
              response = await fetch("/api/db/load", {
                method: "POST",
                body: form,
                signal: controller.signal,
              });
            } else {
              response = await fetch("/api/db/load", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ table, url: datasetUrl }),
                signal: controller.signal,
              });
            }

            if (!response.ok) {
              const detail = await response.text().catch(() => "");
              throw new Error(
                detail || `DuckDB load failed (${response.status})`,
              );
            }
            const payload = (await response.json()) as {
              columns?: Array<{ name: string; type?: string }>;
              rowCount?: number;
            };
            if (Array.isArray(payload.columns) && payload.columns.length > 0) {
              initialColumnsMeta = payload.columns.map((col) => ({
                name: col?.name ?? "",
                type: typeof col?.type === "string" ? col.type : "",
              }));
            }
            if (
              typeof payload.rowCount === "number" &&
              Number.isFinite(payload.rowCount)
            ) {
              initialRowCount = payload.rowCount;
            }
            setState((prev) => ({
              ...prev,
              columns:
                initialColumnsMeta && initialColumnsMeta.length > 0
                  ? initialColumnsMeta.map((col) => ({
                      name: col.name,
                      dataType: col.type,
                    }))
                  : prev.columns,
              rowCount:
                typeof initialRowCount === "number"
                  ? initialRowCount
                  : prev.rowCount,
              progress: {
                loaded: 0,
                total: initialRowCount,
                unit: "rows",
              },
              isChunked: true,
            }));
          } catch (error) {
            duckdbAbortRef.current = null;
            try {
              worker.terminate();
            } catch (terminateError) {
              console.warn(
                "useCSVLoader: failed to terminate DuckDB table worker",
                terminateError,
              );
            }
            duckdbClientRef.current = null;
            duckdbLoadedRowsRef.current = new Set();
            ensureRangeRef.current = null;
            if (error instanceof DOMException && error.name === "AbortError") {
              setState((prev) => ({ ...prev, isLoading: false }));
            } else {
              console.error("DuckDB load error:", error);
              setState((prev) => ({
                ...prev,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to load DuckDB table",
                isLoading: false,
              }));
            }
            return;
          } finally {
            duckdbAbortRef.current = null;
          }
        } else {
          duckdbAbortRef.current = null;
        }

        worker.postMessage({
          type: "init",
          table,
          chunkSize,
          columns: initialColumnsMeta,
          rowCount: initialRowCount,
        });

        ensureRangeRef.current = (start: number, end: number) => {
          const active = duckdbClientRef.current;
          if (!active) return Promise.resolve();
          const cappedStart = Math.max(0, start);
          const cappedEnd = Math.max(cappedStart, end);
          const requestId = active.nextRequestId++;
          const hadPending = active.pending.size > 0;
          active.worker.postMessage({
            type: "loadRange",
            requestId,
            start: cappedStart,
            end: cappedEnd,
          });
          if (!hadPending) {
            setState((prev) =>
              prev.isLoading ? prev : { ...prev, isLoading: true },
            );
          }
          return new Promise<void>((resolve, reject) => {
            active.pending.set(requestId, { resolve, reject });
          });
        };

        try {
          await ensureRangeRef.current(0, chunkSize - 1);
          setState((prev) => ({ ...prev, isLoading: false }));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            console.warn(
              "useCSVLoader: initial DuckDB range fetch aborted",
              error,
            );
          } else {
            console.error(
              "useCSVLoader: initial DuckDB range fetch failed",
              error,
            );
            setState((prev) => ({
              ...prev,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch DuckDB range",
              isLoading: false,
            }));
          }
          return;
        }

        return;
      }

      try {
        const startTime = performance.now();
        csvEvent("start");
        const canStream =
          typeof Worker !== "undefined" && (source.url || source.file);

        if (canStream) {
          const w = csvWorkerFactory();
          if (w) {
            workerRef.current = w;
            streamingStateRef.current = {
              rowsBuffer: [],
              flushScheduled: false,
              rafId: null,
              pendingBatchId: null,
              isPaused: false,
            };
            w.onmessage = (ev: MessageEvent<CsvWorkerMessage>) => {
              const data = ev.data;
              switch (data.type) {
                case "columns":
                  setState((prev) => ({
                    ...prev,
                    columns: data.columns.map((name) => ({ name })),
                  }));
                  break;
                case "rows": {
                  const streamingState = streamingStateRef.current;
                  if (!streamingState) break;
                  streamingState.rowsBuffer.push(...data.rows);
                  streamingState.pendingBatchId =
                    typeof data.id === "number" ? data.id : null;
                  csvEvent("batch", {
                    rows: Array.isArray(data.rows)
                      ? data.rows.length
                      : undefined,
                  });
                  if (
                    !streamingState.isPaused &&
                    streamingState.rowsBuffer.length >= MAX_BUFFER_SIZE &&
                    workerRef.current
                  ) {
                    workerRef.current.postMessage({ type: "pause" });
                    streamingState.isPaused = true;
                  }
                  if (!streamingState.flushScheduled) {
                    streamingState.flushScheduled = true;
                    if (typeof window !== "undefined") {
                      streamingState.rafId = window.requestAnimationFrame(
                        () => {
                          const current = streamingStateRef.current;
                          if (!current) return;
                          current.rafId = null;
                          flushStreamingRows();
                        },
                      );
                    } else {
                      flushStreamingRows();
                    }
                  }
                  break;
                }
                case "progress":
                  setState((prev) => ({
                    ...prev,
                    progress: {
                      loaded: data.loaded ?? 0,
                      total: data.total,
                      unit: "bytes",
                    },
                  }));
                  break;
                case "done": {
                  const endTime = performance.now();
                  flushStreamingRows();
                  console.log(
                    `CSV streamed in ${(endTime - startTime).toFixed(2)}ms`,
                  );
                  csvEvent("done", { ms: endTime - startTime });
                  setState((prev) => ({ ...prev, isLoading: false }));
                  streamingStateRef.current = null;
                  w.terminate();
                  workerRef.current = null;
                  break;
                }
                case "aborted":
                  flushStreamingRows();
                  setState((prev) => ({ ...prev, isLoading: false }));
                  streamingStateRef.current = null;
                  w.terminate();
                  workerRef.current = null;
                  break;
                case "error":
                  flushStreamingRows();
                  setState((prev) => ({
                    ...prev,
                    error: data.message,
                    isLoading: false,
                  }));
                  streamingStateRef.current = null;
                  w.terminate();
                  workerRef.current = null;
                  break;
                default:
                  console.warn("useCSVLoader: unknown worker message", data);
              }
            };
            w.postMessage({
              type: "load",
              url: source.url,
              file: source.file,
              batchSize: 2000,
            });
            return;
          }
        }

        streamingStateRef.current = null;
        let result;
        const file = source.file;
        if (file) {
          // Check if it's an Excel file
          if (isExcelFile(file.name)) {
            result = await parseExcelFile(file);
          } else {
            result = await parseCSVFile(file);
          }
          setState((prev) => ({
            ...prev,
            progress: { loaded: file.size, unit: "bytes" },
          }));
        } else if (source.url) {
          result = await fetchAndParseCSV(source.url);
        } else {
          throw new Error("No source provided");
        }
        const endTime = performance.now();
        const fileType = file && isExcelFile(file.name) ? "Excel" : "CSV";
        console.log(`${fileType} parsed in ${(endTime - startTime).toFixed(2)}ms`);
        csvEvent("done", { ms: endTime - startTime });
        const loadedRowIndices = Array.from(
          { length: result.rows.length },
          (_, i) => i,
        );
        setState({
          columns: result.columns,
          rows: result.rows,
          progress: {
            loaded: result.rows.length,
            total: result.rows.length,
            unit: "rows",
          },
          isLoading: false,
          error: null,
          rowCount: result.rows.length,
          isChunked: false,
          loadedRowIndices,
        });
      } catch (error) {
        console.error("CSV loading error:", error);
        streamingStateRef.current = null;
        if (workerRef.current) {
          try {
            workerRef.current.terminate();
          } catch (terminateError) {
            console.warn(
              "useCSVLoader: failed to terminate CSV worker after error",
              terminateError,
            );
          }
          workerRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Failed to load CSV",
          isLoading: false,
        }));
      }
    },
    [flushStreamingRows, showToast, cleanupWorker],
  );

  const cancel = useCallback(() => {
    if (workerRef.current) {
      flushStreamingRows();
      try {
        workerRef.current.postMessage({ type: "abort" });
      } catch (error) {
        console.warn(
          "useCSVLoader: failed to signal abort to CSV worker",
          error,
        );
      }
    }
    if (duckdbAbortRef.current) {
      duckdbAbortRef.current.abort();
      duckdbAbortRef.current = null;
    }
    if (duckdbClientRef.current) {
      cleanupWorker(duckdbClientRef.current.worker);
      duckdbClientRef.current = null;
    }
    duckdbLoadedRowsRef.current = new Set();
    ensureRangeRef.current = null;
    setState((prev) => ({ ...prev, isLoading: false }));
  }, [flushStreamingRows, cleanupWorker]);

  const reset = useCallback(() => {
    flushStreamingRows();
    setState({
      columns: [],
      rows: [],
      progress: { loaded: 0 },
      isLoading: false,
      error: null,
      rowCount: 0,
      isChunked: false,
      loadedRowIndices: [],
    });
    if (workerRef.current) {
      cleanupWorker(workerRef.current);
      workerRef.current = null;
    }
    streamingStateRef.current = null;
    duckdbAbortRef.current = null;
    if (duckdbClientRef.current) {
      cleanupWorker(duckdbClientRef.current.worker);
      duckdbClientRef.current = null;
    }
    duckdbLoadedRowsRef.current = new Set();
    ensureRangeRef.current = null;
  }, [flushStreamingRows, cleanupWorker]);

  const setFiltersAndSort = useCallback(
    async (
      filters: Record<number, string>,
      sort?: { colIndex: number; dir: "asc" | "desc" },
    ) => {
      const client = duckdbClientRef.current;
      if (!client) return;

      const columns = columnsRef.current;

      client.worker.postMessage({
        type: "init",
        table: duckdbTableRef.current,
        chunkSize: client.chunkSize,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.dataType ?? "",
        })),
        filters,
        sort,
      });

      duckdbLoadedRowsRef.current = new Set();

      setState((prev) => ({
        ...prev,
        isLoading: true,
        loadedRowIndices: [],
      }));

      if (ensureRangeRef.current) {
        try {
          await ensureRangeRef.current(0, client.chunkSize - 1);
        } catch (error) {
          console.error("Failed to fetch filtered data:", error);
        }
      }
    },
    [],
  );

  return {
    ...state,
    loadSource,
    reset,
    cancel,
    setFiltersAndSort,
    ensureRange: (start: number, end: number) =>
      ensureRangeRef.current
        ? ensureRangeRef.current(start, end)
        : Promise.resolve(),
    updateCell: (rowIndex: number, colIndex: number, value: string) => {
      const normalizedValue = value ?? "";
      setState((prev) => {
        const nextRows = prev.rows.slice();
        if (nextRows.length <= rowIndex) nextRows.length = rowIndex + 1;
        const row = nextRows[rowIndex]
          ? nextRows[rowIndex]!.slice()
          : ([] as string[]);
        if (colIndex >= row.length) row.length = colIndex + 1;
        row[colIndex] = normalizedValue;
        nextRows[rowIndex] = row;
        return { ...prev, rows: nextRows };
      });
      if (duckdbClientRef.current) {
        persistDuckDBUpdates([
          { rowIndex, colIndex, value: normalizedValue },
        ]).catch((err) => {
          console.error("DuckDB mutation error:", err);
          setState((prev) => ({
            ...prev,
            error:
              err instanceof Error ? err.message : "Failed to persist change",
          }));
        });
      }
    },
    applyPaste: (startRow: number, startCol: number, values: string[][]) => {
      const normalized: string[][] = values.map(
        (row) => row.map((cell) => cell ?? "") as string[],
      );
      setState((prev) => {
        const nextRows = prev.rows.slice();
        for (let rOff = 0; rOff < normalized.length; rOff++) {
          const rIndex = startRow + rOff;
          const src = (normalized[rOff] ?? []) as string[];
          if (nextRows.length <= rIndex) nextRows.length = rIndex + 1;
          const row = nextRows[rIndex]
            ? nextRows[rIndex]!.slice()
            : ([] as string[]);
          for (let cOff = 0; cOff < src.length; cOff++) {
            const cIndex = startCol + cOff;
            if (cIndex >= row.length) row.length = cIndex + 1;
            row[cIndex] = src[cOff] ?? "";
          }
          nextRows[rIndex] = row;
        }
        return { ...prev, rows: nextRows };
      });
      if (duckdbClientRef.current) {
        const mutations: Array<{
          rowIndex: number;
          colIndex: number;
          value: string;
        }> = [];
        for (let rOff = 0; rOff < normalized.length; rOff++) {
          const rIndex = startRow + rOff;
          const src = (normalized[rOff] ?? []) as string[];
          for (let cOff = 0; cOff < src.length; cOff++) {
            const cIndex = startCol + cOff;
            mutations.push({
              rowIndex: rIndex,
              colIndex: cIndex,
              value: src[cOff] ?? "",
            });
          }
        }
        persistDuckDBUpdates(mutations).catch((err) => {
          console.error("DuckDB mutation error:", err);
          setState((prev) => ({
            ...prev,
            error:
              err instanceof Error
                ? err.message
                : "Failed to persist pasted cells",
          }));
        });
      }
    },
    clearCells: (cells: Array<{ row: number; col: number }>) => {
      if (cells.length === 0) return;
      setState((prev) => {
        const nextRows = prev.rows.slice();
        const touched = new Map<number, number[]>();
        for (const { row, col } of cells) {
          if (!touched.has(row)) touched.set(row, []);
          touched.get(row)!.push(col);
        }
        for (const [rIndex, cols] of touched) {
          if (nextRows.length <= rIndex) nextRows.length = rIndex + 1;
          const row = nextRows[rIndex]
            ? nextRows[rIndex]!.slice()
            : ([] as string[]);
          for (const col of cols) {
            if (col < row.length) row[col] = "";
          }
          nextRows[rIndex] = row;
        }
        return { ...prev, rows: nextRows };
      });
      if (duckdbClientRef.current) {
        const mutations = cells.map(({ row, col }) => ({
          rowIndex: row,
          colIndex: col,
          value: "",
        }));
        persistDuckDBUpdates(mutations).catch((err) => {
          console.error("DuckDB mutation error:", err);
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Failed to clear cells",
          }));
        });
      }
    },
  };
}
