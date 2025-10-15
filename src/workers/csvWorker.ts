/* eslint-disable no-restricted-globals */
import { parseStream } from "@/lib/streamingCSV";

interface WorkerRequest {
  url?: string;
  file?: File;
  batchSize?: number;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { url, file, batchSize = 2000 } = e.data;
  try {
    if (url) {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Failed to fetch: ${res.status}`);
      const len = res.headers.get("content-length");
      const totalBytes = len ? Number(len) : undefined;
      const reader = res.body.getReader();
      await parseStream(reader, {
        batchSize,
        totalBytes,
        onColumns: (columns) => self.postMessage({ type: "columns", columns }),
        onRows: (rows) => self.postMessage({ type: "rows", rows }),
        onProgress: (p) => self.postMessage({ type: "progress", ...p }),
      });
      self.postMessage({ type: "done" });
      close();
      return;
    }
    if (file) {
      const reader = file.stream().getReader();
      await parseStream(reader, {
        batchSize,
        totalBytes: file.size,
        onColumns: (columns) => self.postMessage({ type: "columns", columns }),
        onRows: (rows) => self.postMessage({ type: "rows", rows }),
        onProgress: (p) => self.postMessage({ type: "progress", ...p }),
      });
      self.postMessage({ type: "done" });
      close();
      return;
    }
    throw new Error("No source provided");
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    close();
  }
};
