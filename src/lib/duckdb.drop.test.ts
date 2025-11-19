import { beforeAll, describe, expect, test } from "bun:test";
import {
  initDuckDB,
  loadMultipleSources,
  listTables,
  dropTables,
} from "@/lib/duckdb";

describe("duckdb drop tables", () => {
  beforeAll(async () => {
    await initDuckDB();
  });

  test("drops specified tables", async () => {
    const t1 = `tmp_drop_a_${Date.now()}`;
    const t2 = `tmp_drop_b_${Date.now()}`;
    await loadMultipleSources([
      { source: { blob: new Blob(["c1\nc\n"]) }, table: t1 },
      { source: { blob: new Blob(["d1\nd\n"]) }, table: t2 },
    ]);
    let names = await listTables();
    expect(names).toEqual(expect.arrayContaining([t1, t2]));
    const dropped = await dropTables([t1]);
    expect(dropped).toBe(1);
    names = await listTables();
    expect(names).not.toContain(t1);
    expect(names).toContain(t2);
    await dropTables([t2]);
    names = await listTables();
    expect(names).not.toContain(t2);
  });
});
