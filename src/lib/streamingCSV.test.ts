import { test, expect } from "bun:test";
import { parseStream } from "./streamingCSV";

function readerFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  // @ts-expect-error bun types ok
  return stream.getReader();
}

test("parseStream handles quotes across chunk boundaries", async () => {
  const rows: string[][] = [];
  const columns: string[][] = [] as unknown as string[][];
  const reader = readerFromChunks([
    'a,b\n"he',
    'llo, wor',
    'ld",42\n1,2\n',
  ]);
  await parseStream(reader, {
    batchSize: 1,
    onColumns: (cols) => columns.push(cols as unknown as string[]),
    onRows: (r) => rows.push(...r),
  });
  expect(columns[0]).toEqual(["a", "b"]);
  expect(rows).toEqual([["hello, world", "42"], ["1", "2"]]);
});

test("parseStream emits batches", async () => {
  const rows: string[][] = [];
  const reader = readerFromChunks(["h1,h2\n", "1,2\n3,4\n5,6\n"]);
  await parseStream(reader, {
    batchSize: 2,
    onRows: (r) => rows.push(...r),
  });
  expect(rows.length).toBe(3);
});
