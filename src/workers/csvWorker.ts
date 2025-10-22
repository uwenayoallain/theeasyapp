/* eslint-disable no-restricted-globals */
import { parseStream } from "@/lib/streamingCSV";

type WorkerLoadRequest = {
  type: "load";
  url?: string;
  file?: File;
  batchSize?: number;
};

type WorkerAbortRequest = { type: "abort" };
type WorkerAckMessage = { type: "ack"; id: number };
type WorkerPauseMessage = { type: "pause" };
type WorkerResumeMessage = { type: "resume" };

type WorkerInboundMessage =
  | WorkerLoadRequest
  | WorkerAbortRequest
  | WorkerAckMessage
  | WorkerPauseMessage
  | WorkerResumeMessage;

let abortController: AbortController | null = null;
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let resolveAck: (() => void) | null = null;
let resolvePause: (() => void) | null = null;
let isLoading = false;
let aborted = false;
let paused = false;

const waitForAck = () =>
  new Promise<void>((resolve) => {
    resolveAck = resolve;
  });

const waitForResume = () =>
  new Promise<void>((resolve) => {
    resolvePause = resolve;
  });

self.addEventListener(
  "message",
  async (event: MessageEvent<WorkerInboundMessage>) => {
    const data = event.data;

    if (data?.type === "ack") {
      resolveAck?.();
      resolveAck = null;
      return;
    }

    if (data?.type === "pause") {
      paused = true;
      return;
    }

    if (data?.type === "resume") {
      paused = false;
      resolvePause?.();
      resolvePause = null;
      return;
    }

    if (data?.type === "abort") {
      aborted = true;
      abortController?.abort();
      resolveAck?.();
      resolveAck = null;
      resolvePause?.();
      resolvePause = null;
      try {
        await currentReader?.cancel();
      } catch (error) {
        console.warn("csvWorker: failed to cancel current reader", error);
      }
      return;
    }

    if (data?.type !== "load" || isLoading) return;

    const { url, file, batchSize = 2000 } = data;
    abortController = new AbortController();
    isLoading = true;
    aborted = false;
    let nextBatchId = 0;

    try {
      if (url) {
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok || !response.body)
          throw new Error(`Failed to fetch: ${response.status}`);
        const len = response.headers.get("content-length");
        const totalBytes = len ? Number(len) : undefined;
        const reader = response.body.getReader();
        currentReader = reader;
        await parseStream(reader, {
          batchSize,
          totalBytes,
          signal: abortController.signal,
          onColumns: (columns) =>
            self.postMessage({ type: "columns", columns }),
          onRows: async (rows) => {
            if (!rows.length) return;
            const id = ++nextBatchId;
            self.postMessage({ type: "rows", id, rows });
            await waitForAck();
            if (paused) {
              await waitForResume();
            }
          },
          onProgress: (p) => self.postMessage({ type: "progress", ...p }),
        });
        self.postMessage({ type: "done" });
        close();
        return;
      }

      if (file) {
        const reader = file.stream().getReader();
        currentReader = reader;
        await parseStream(reader, {
          batchSize,
          totalBytes: file.size,
          signal: abortController.signal,
          onColumns: (columns) =>
            self.postMessage({ type: "columns", columns }),
          onRows: async (rows) => {
            if (!rows.length) return;
            const id = ++nextBatchId;
            self.postMessage({ type: "rows", id, rows });
            await waitForAck();
            if (paused) {
              await waitForResume();
            }
          },
          onProgress: (p) => self.postMessage({ type: "progress", ...p }),
        });
        self.postMessage({ type: "done" });
        close();
        return;
      }

      throw new Error("No source provided");
    } catch (err) {
      if (
        aborted ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        self.postMessage({ type: "aborted" });
      } else {
        self.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      close();
    } finally {
      resolveAck?.();
      resolveAck = null;
      resolvePause?.();
      resolvePause = null;
      abortController = null;
      currentReader = null;
      isLoading = false;
      paused = false;
    }
  },
);
