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

test("parseStream handles multi-line quoted field within single chunk", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks(['a,b\n"hello\nworld",42\n1,2\n']);
  await parseStream(reader, {
    batchSize: 10,
    onRows: (batch) => {
      rows.push(...batch);
    },
  });
  expect(rows).toEqual([
    ["hello\nworld", "42"],
    ["1", "2"],
  ]);
});

test("parseStream handles multi-line quoted field across chunk boundaries", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks(['a,b\n"hello', '\nworld",42\n', "1,2\n"]);
  await parseStream(reader, {
    batchSize: 10,
    onRows: (batch) => {
      rows.push(...batch);
    },
  });
  expect(rows).toEqual([
    ["hello\nworld", "42"],
    ["1", "2"],
  ]);
});

test("parseStream handles embedded quotes and CRLF with multiline", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks([
    'a,b\r\n"he""llo',
    '\r\nworld",99\r\n3,4\r\n',
  ]);
  await parseStream(reader, {
    batchSize: 2,
    onRows: (batch) => {
      rows.push(...batch);
    },
  });
  expect(rows).toEqual([
    ['he"llo\r\nworld', "99"],
    ["3", "4"],
  ]);
});

test("parseStream reports approximate progress in bytes", async () => {
  const enc = new TextEncoder();
  const chunks = ["a,b\n1,2\n", "3,4\n"];
  const totalBytes = chunks
    .map((c) => enc.encode(c).byteLength)
    .reduce((a, b) => a + b, 0);
  const reader = readerFromChunks(chunks);
  let lastLoaded = 0;
  await parseStream(reader, {
    batchSize: 10,
    onRows: () => {},
    onProgress: (p) => {
      lastLoaded = p.loaded;
    },
  });
  expect(lastLoaded).toBe(totalBytes);
});
