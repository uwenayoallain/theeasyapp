import { beforeAll, describe, expect, test } from "bun:test";
import {
  initDuckDB,
  listTables,
  loadMultipleSources,
  getTableChunk,
} from "@/lib/duckdb";
import { deriveTableNameFromFilename } from "@/lib/duckdb-utils";

describe("duckdb multi-source ingestion", () => {
  beforeAll(async () => {
    await initDuckDB();
  });

  test("loads multiple files into distinct tables", async () => {
    const sources = [
      {
        source: { blob: new Blob(["a,b\n1,2\n3,4\n"]), name: "first.csv" },
        table: deriveTableNameFromFilename("first.csv", "t_1"),
      },
      {
        source: { blob: new Blob(["x\ty\nfoo\tbar\n"]), name: "second.tsv" },
        table: deriveTableNameFromFilename("second.tsv", "t_2"),
      },
    ];

    const loaded = await loadMultipleSources(sources);
    expect(loaded.length).toBe(2);
    const names = loaded.map((r) => r.table).sort();
    expect(names).toEqual(
      [
        deriveTableNameFromFilename("first.csv", "t_1"),
        deriveTableNameFromFilename("second.tsv", "t_2"),
      ].sort(),
    );

    const tables = await listTables();
    expect(tables).toEqual(expect.arrayContaining(names));

    const chunk1 = await getTableChunk(names[0]!, 0, 5);
    const chunk2 = await getTableChunk(names[1]!, 0, 5);
    expect(chunk1.columns.length).toBeGreaterThan(0);
    expect(chunk2.columns.length).toBeGreaterThan(0);
  });
});
