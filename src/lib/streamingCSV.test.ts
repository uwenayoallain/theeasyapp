import { test, expect } from "bun:test";
import { parseStream } from "./streamingCSV";

function readerFromChunks(
  chunks: string[],
): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return stream.getReader();
}

test("parseStream handles quotes across chunk boundaries", async () => {
  const rows: string[][] = [];
  const columns: string[][] = [];
  const reader = readerFromChunks(['a,b\n"he', "llo, wor", 'ld",42\n1,2\n']);
  await parseStream(reader, {
    batchSize: 1,
    onColumns: (cols) => {
      columns.push(cols);
    },
    onRows: (r) => {
      rows.push(...r);
    },
  });
  expect(columns[0]).toEqual(["a", "b"]);
  expect(rows).toEqual([
    ["hello, world", "42"],
    ["1", "2"],
  ]);
});

test("parseStream emits batches", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks(["h1,h2\n", "1,2\n3,4\n5,6\n"]);
  await parseStream(reader, {
    batchSize: 2,
    onRows: (r) => {
      rows.push(...r);
    },
  });
  expect(rows.length).toBe(3);
});

test("parseStream respects abort signal", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks(["a,b\n", "1,2\n", "3,4\n"]);
  const controller = new AbortController();
  await expect(
    parseStream(reader, {
      batchSize: 1,
      signal: controller.signal,
      onRows: async (batch) => {
        rows.push(...batch);
        controller.abort();
      },
    }),
  ).rejects.toHaveProperty("name", "AbortError");
  expect(rows).toEqual([["1", "2"]]);
});

test("parseStream awaits async onRows handlers sequentially", async () => {
  const reader = readerFromChunks(["a,b\n", "1,2\n", "3,4\n"]);
  const batches: number[] = [];
  await parseStream(reader, {
    batchSize: 1,
    onRows: async (batch) => {
      batches.push(batch.length);
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  });
  expect(batches).toEqual([1, 1]);
});
