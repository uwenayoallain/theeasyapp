/* eslint-disable no-restricted-globals */
import { logger } from "@/lib/logger";

type DuckDBWorkerContext = typeof globalThis & {
  DUCKDB_WORKER_CACHE_SIZE?: number | string;
};

declare const self: DuckDBWorkerContext;

interface ColumnMeta {
  name: string;
  type: string;
}

interface InitMessage {
  type: "init";
  table: string;
  chunkSize: number;
  columns?: ColumnMeta[];
  rowCount?: number;
  filters?: Record<number, string>;
  sort?: { colIndex: number; dir: string };
}

interface LoadRangeMessage {
  type: "loadRange";
  requestId: number;
  start: number;
  end: number;
}

interface InvalidateMessage {
  type: "invalidate";
  rows: number[];
}

type IncomingMessage =
  | InitMessage
  | LoadRangeMessage
  | InvalidateMessage
  | { type: "reset" };

type RowsMessage = {
  type: "rows";
  requestId: number;
  rows: Array<{ index: number; values: string[] }>;
  rowCount?: number;
  columns?: ColumnMeta[];
};

type ReadyMessage = {
  type: "ready";
  columns?: ColumnMeta[];
  rowCount?: number;
};

type ErrorMessage = { type: "error"; requestId?: number; message: string };

interface ChunkMetadata {
  accessCount: number;
  lastAccess: number;
}

interface WorkerState {
  table: string;
  chunkSize: number;
  columns: ColumnMeta[];
  rowCount: number;
  chunks: Map<number, string[][]>;
  chunkAccessOrder: number[];
  chunkMetadata: Map<number, ChunkMetadata>;
  chunkETags: Map<number, string>;
  inflight: Map<number, Promise<void>>;
  controller: AbortController | null;
  filters: Record<number, string>;
  sort: { colIndex: number; dir: string } | null;
}

const MAX_CACHED_CHUNKS = Number(self.DUCKDB_WORKER_CACHE_SIZE ?? "50");

const state: WorkerState = {
  table: "dataset",
  chunkSize: 2000,
  columns: [],
  rowCount: 0,
  chunks: new Map(),
  chunkAccessOrder: [],
  chunkMetadata: new Map(),
  chunkETags: new Map(),
  inflight: new Map(),
  controller: null,
  filters: {},
  sort: null,
};

const post = (message: RowsMessage | ReadyMessage | ErrorMessage) => {
  self.postMessage(message);
};

const abortCurrent = () => {
  if (state.controller) {
    try {
      state.controller.abort();
    } catch (error) {
      logger.warn("tableWorker: abort controller failure", error);
    }
  }
  state.controller = new AbortController();
};

const trackChunkAccess = (chunkIndex: number) => {
  const existingIndex = state.chunkAccessOrder.indexOf(chunkIndex);
  if (existingIndex !== -1) {
    state.chunkAccessOrder.splice(existingIndex, 1);
  }
  state.chunkAccessOrder.push(chunkIndex);

  const metadata = state.chunkMetadata.get(chunkIndex) ?? {
    accessCount: 0,
    lastAccess: 0,
  };
  metadata.accessCount++;
  metadata.lastAccess = Date.now();
  state.chunkMetadata.set(chunkIndex, metadata);
};

const evictOldChunks = () => {
  while (
    state.chunks.size >= MAX_CACHED_CHUNKS &&
    state.chunkAccessOrder.length > 0
  ) {
    let oldestChunk: number | undefined;
    let lowestScore = Infinity;

    for (const chunkIndex of state.chunkAccessOrder) {
      const metadata = state.chunkMetadata.get(chunkIndex);
      if (!metadata) continue;

      const age = Date.now() - metadata.lastAccess;
      const score = metadata.accessCount * 1000 - age;

      if (score < lowestScore) {
        lowestScore = score;
        oldestChunk = chunkIndex;
      }
    }

    if (oldestChunk !== undefined) {
      state.chunks.delete(oldestChunk);
      state.chunkMetadata.delete(oldestChunk);
      state.chunkETags.delete(oldestChunk);
      const idx = state.chunkAccessOrder.indexOf(oldestChunk);
      if (idx !== -1) {
        state.chunkAccessOrder.splice(idx, 1);
      }
    } else {
      const fallbackChunk = state.chunkAccessOrder.shift();
      if (fallbackChunk !== undefined) {
        state.chunks.delete(fallbackChunk);
        state.chunkMetadata.delete(fallbackChunk);
        state.chunkETags.delete(fallbackChunk);
      }
    }
  }
};

const ensureChunk = (index: number): Promise<void> => {
  if (state.chunks.has(index)) return Promise.resolve();
  const existing = state.inflight.get(index);
  if (existing) return existing;
  const promise = fetchChunk(index)
    .catch((error) => {
      post({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      state.inflight.delete(index);
    });
  state.inflight.set(index, promise);
  return promise;
};

const fetchChunk = async (index: number): Promise<void> => {
  const controller = state.controller ?? new AbortController();
  state.controller = controller;
  const offset = index * state.chunkSize;

  const params = new URLSearchParams({
    table: state.table,
    offset: offset.toString(),
    limit: state.chunkSize.toString(),
  });

  if (Object.keys(state.filters).length > 0) {
    params.set("filters", JSON.stringify(state.filters));
  }

  if (state.sort) {
    params.set("sort", JSON.stringify(state.sort));
  }

  const headers: Record<string, string> = {};
  const cachedChunk = state.chunks.get(index);
  if (cachedChunk) {
    const etag = state.chunkETags.get(index);
    if (etag) {
      headers["If-None-Match"] = etag;
    }
  }

  const response = await fetch(`/api/db/preview?${params.toString()}`, {
    signal: controller.signal,
    headers,
  });

  if (response.status === 304) {
    trackChunkAccess(index);
    return;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Preview failed (${response.status})`);
  }

  const etag = response.headers.get("etag");
  if (etag) {
    state.chunkETags.set(index, etag);
  }
  const payload = (await response.json()) as {
    columns?: ColumnMeta[];
    rows?: string[][];
    rowCount?: number;
    offset: number;
    limit: number;
  };
  if (Array.isArray(payload.columns) && payload.columns.length > 0) {
    state.columns = payload.columns;
  }
  if (
    typeof payload.rowCount === "number" &&
    Number.isFinite(payload.rowCount)
  ) {
    state.rowCount = payload.rowCount;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  evictOldChunks();

  state.chunks.set(index, rows);
  trackChunkAccess(index);
};

const gatherRows = (start: number, end: number) => {
  const rows: Array<{ index: number; values: string[] }> = [];
  const total = state.rowCount;
  const maxIndex = Math.max(end, total - 1);
  for (let rowIndex = start; rowIndex <= maxIndex; rowIndex++) {
    const chunkIndex = Math.floor(rowIndex / state.chunkSize);
    const within = rowIndex - chunkIndex * state.chunkSize;
    const chunk = state.chunks.get(chunkIndex);
    if (!chunk) continue;

    trackChunkAccess(chunkIndex);

    const values = chunk[within];
    if (!values) continue;
    rows.push({ index: rowIndex, values });
  }
  const lastLoadedIndex =
    rows.length > 0 ? rows[rows.length - 1]!.index + 1 : 0;
  const inferredRowCount = Math.max(total, lastLoadedIndex, end + 1);
  return { rows, rowCount: total > 0 ? total : inferredRowCount };
};

const handleInit = (message: InitMessage) => {
  state.table = message.table;
  state.chunkSize =
    message.chunkSize > 0 ? Math.floor(message.chunkSize) : 2000;

  const filtersChanged =
    JSON.stringify(state.filters) !== JSON.stringify(message.filters ?? {});
  const sortChanged =
    JSON.stringify(state.sort) !== JSON.stringify(message.sort ?? null);

  state.filters = message.filters ?? {};
  state.sort = message.sort ?? null;

  if (filtersChanged || sortChanged) {
    state.chunks.clear();
    state.chunkAccessOrder = [];
    state.chunkMetadata.clear();
    state.chunkETags.clear();
    state.inflight.clear();
    abortCurrent();
  }

  state.columns = Array.isArray(message.columns)
    ? message.columns
    : state.columns;
  state.rowCount =
    typeof message.rowCount === "number" && Number.isFinite(message.rowCount)
      ? message.rowCount
      : state.rowCount;
  post({ type: "ready", columns: state.columns, rowCount: state.rowCount });
};

const handleLoadRange = async (message: LoadRangeMessage) => {
  try {
    const start = Math.max(0, Math.min(message.start, message.end));
    const end = Math.max(start, message.end);
    const firstChunk = Math.floor(start / state.chunkSize);
    const lastChunk = Math.floor(end / state.chunkSize);
    for (let chunk = firstChunk; chunk <= lastChunk; chunk++) {
      await ensureChunk(chunk);
    }
    const payload = gatherRows(start, end);
    post({
      type: "rows",
      requestId: message.requestId,
      rows: payload.rows,
      rowCount: payload.rowCount,
      columns: state.columns,
    });
  } catch (error) {
    post({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleInvalidate = (message: InvalidateMessage) => {
  if (!Array.isArray(message.rows)) return;
  for (const rowIndex of message.rows) {
    if (
      typeof rowIndex !== "number" ||
      !Number.isFinite(rowIndex) ||
      rowIndex < 0
    )
      continue;
    const chunkIndex = Math.floor(rowIndex / state.chunkSize);
    state.chunks.delete(chunkIndex);
    state.inflight.delete(chunkIndex);
    const accessIndex = state.chunkAccessOrder.indexOf(chunkIndex);
    if (accessIndex !== -1) {
      state.chunkAccessOrder.splice(accessIndex, 1);
    }
  }
};

self.addEventListener("message", (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;
  if (!data) return;
  switch (data.type) {
    case "init":
      handleInit(data);
      break;
    case "loadRange":
      handleLoadRange(data);
      break;
    case "invalidate":
      handleInvalidate(data);
      break;
    case "reset":
      state.chunks.clear();
      state.chunkAccessOrder = [];
      state.chunkMetadata.clear();
      state.chunkETags.clear();
      state.inflight.clear();
      abortCurrent();
      break;
    default:
      break;
  }
});
