import { beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_DUCKDB_TABLE } from "@/constants/duckdb";
import {
  getTableChunk,
  initDuckDB,
  loadCsvFromSource,
  runQuery,
} from "@/lib/duckdb";

describe("duckdb integration", () => {
  beforeAll(async () => {
    await initDuckDB();
  });

  test("returns a chunk of data from the default table", async () => {
    const chunk = await getTableChunk(DEFAULT_DUCKDB_TABLE, 0, 5);
    expect(chunk.columns.length).toBeGreaterThan(0);
    expect(chunk.rows.length).toBeGreaterThan(0);
    expect(chunk.rowCount).toBeGreaterThanOrEqual(chunk.rows.length);
    expect(chunk.offset).toBe(0);
    expect(chunk.limit).toBeGreaterThan(0);
  });

  test("supports simple aggregate queries", async () => {
    const rows = await runQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ${DEFAULT_DUCKDB_TABLE}`,
    );
    expect(rows.length).toBe(1);
    expect(Number(rows[0]?.total)).toBeGreaterThan(0);
  });

  test("ingests csv data from blob sources", async () => {
    const tableName = `blob_ingest_${Date.now()}`;
    const csv = new Blob(["city,temp\nParis,72\nRome,81\n"]);
    await loadCsvFromSource({ blob: csv }, tableName);
    const chunk = await getTableChunk(tableName, 0, 10);
    expect(chunk.columns.map((c) => c.name)).toEqual(["city", "temp"]);
    expect(chunk.rows[0]).toEqual(["Paris", "72"]);
    expect(chunk.rowCount).toBeGreaterThanOrEqual(2);
  });
});
