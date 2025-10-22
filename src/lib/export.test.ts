import { test, expect } from "bun:test";
import { selectionToTSV } from "./export";

test("selectionToTSV returns empty string for empty selection", () => {
  expect(selectionToTSV(new Set(), [])).toBe("");
});

test("selectionToTSV outputs single cell value", () => {
  const rows = [["A", "B"]];
  expect(selectionToTSV(new Set(["0:1"]), rows)).toBe("B");
});

test("selectionToTSV orders by row then col and groups per row", () => {
  const rows = [
    ["r0c0", "r0c1", "r0c2"],
    ["r1c0", "r1c1", "r1c2"],
  ];
  const sel = new Set(["1:2", "0:0", "1:0", "0:2"]);
  expect(selectionToTSV(sel, rows)).toBe("r0c0\tr0c2\nr1c0\tr1c2");
});

test("selectionToTSV preserves empty cells as empty fields", () => {
  const rows = [
    ["a", "", "c"],
    ["", "b", ""],
  ];
  const sel = new Set(["0:0", "0:1", "1:1", "1:2"]);
  expect(selectionToTSV(sel, rows)).toBe("a\t\nb\t");
});
