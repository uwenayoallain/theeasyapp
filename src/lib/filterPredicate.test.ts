import { describe, expect, test } from "bun:test";
import { createFilterPredicate, inferNumericColumns } from "./filterPredicate";

describe("createFilterPredicate", () => {
  test("matches substring case-insensitively", () => {
    const predicate = createFilterPredicate("error");
    expect(predicate("Critical ERROR reported")).toBe(true);
    expect(predicate("All good")).toBe(false);
  });

  test("supports AND semantics for space separated tokens", () => {
    const predicate = createFilterPredicate("error timeout");
    expect(predicate("Error: request timeout")).toBe(true);
    expect(predicate("Error occurred")).toBe(false);
  });

  test("supports OR semantics with || delimiter", () => {
    const predicate = createFilterPredicate("error || warning");
    expect(predicate("Warning: high memory")).toBe(true);
    expect(predicate("Fatal error occurred")).toBe(true);
    expect(predicate("Info: ok")).toBe(false);
  });

  test("handles negation with ! prefix", () => {
    const predicate = createFilterPredicate("error !timeout");
    expect(predicate("Error: disk full")).toBe(true);
    expect(predicate("Error: timeout while waiting")).toBe(false);
  });

  test("respects quoted phrases for exact substring", () => {
    const predicate = createFilterPredicate('"New York"');
    expect(predicate("Flights from new york to sf")).toBe(true);
    expect(predicate("Flights from New Hampshire")).toBe(false);
  });

  test("supports numeric comparisons", () => {
    const predicate = createFilterPredicate(">= 100", { isNumeric: true });
    expect(predicate("150")).toBe(true);
    expect(predicate("99")).toBe(false);
    expect(predicate("")).toBe(false);
  });

  test("supports numeric ranges", () => {
    const predicate = createFilterPredicate("10..20", { isNumeric: true });
    expect(predicate("15")).toBe(true);
    expect(predicate("25")).toBe(false);
  });

  test("supports wildcard patterns", () => {
    const predicate = createFilterPredicate("ERR-*");
    expect(predicate("ERR-123")).toBe(true);
    expect(predicate("WARN-ERR")).toBe(false);
  });

  test("supports equals and not equals for strings when numeric comparison unavailable", () => {
    const eq = createFilterPredicate('= "Done"');
    const neq = createFilterPredicate("!=pending");
    expect(eq("done")).toBe(true);
    expect(eq("Done ")).toBe(false);
    expect(neq("Pending")).toBe(false);
    expect(neq("Complete")).toBe(true);
  });

  test("supports special emptiness predicates", () => {
    const empty = createFilterPredicate("is:empty");
    const filled = createFilterPredicate("is:notempty");
    expect(empty("")).toBe(true);
    expect(empty("   ")).toBe(true);
    expect(empty("value")).toBe(false);
    expect(filled("  data ")).toBe(true);
    expect(filled("")).toBe(false);
  });
});

describe("inferNumericColumns", () => {
  test("infers numeric columns from metadata and sample values", () => {
    const rows = [
      ["1", "foo", "10.5"],
      ["2", "bar", ""],
      ["3", "baz", "11"],
    ];
    const columns = [{ dataType: "INTEGER" }, {}, {}];
    const result = inferNumericColumns(rows, columns);
    expect(result).toEqual([true, false, true]);
  });
});
