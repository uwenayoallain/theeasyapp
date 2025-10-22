import { test, expect, describe } from "bun:test";
import {
  computeSelectionStats,
  parseSelectionKey,
  SelectionModel,
} from "./selection";

test("parseSelectionKey parses row:col pairs", () => {
  expect(parseSelectionKey("3:7")).toEqual([3, 7]);
  expect(parseSelectionKey("0:0")).toEqual([0, 0]);
});

test("computeSelectionStats handles empty selection", () => {
  const stats = computeSelectionStats(new Set(), [["1"]]);
  expect(stats).toEqual({
    count: 0,
    rowsCount: 0,
    colsCount: 0,
    sum: null,
    avg: null,
    min: null,
    max: null,
  });
});

test("computeSelectionStats counts rows/cols and numeric aggregates", () => {
  const rows = [
    ["1", "x", "3"],
    ["4", "5", ""],
    ["hello", "7", "9"],
  ];
  const selection = new Set(["0:0", "0:2", "1:0", "1:1", "2:1", "2:2"]);
  const stats = computeSelectionStats(selection, rows);
  expect(stats.count).toBe(6);
  expect(stats.rowsCount).toBe(3);
  expect(stats.colsCount).toBe(3);
  expect(stats.sum).toBe(29);
  expect(stats.min).toBe(1);
  expect(stats.max).toBe(9);
  expect(stats.avg && Number.isFinite(stats.avg)).toBe(true);
});

test("computeSelectionStats ignores non-numeric and empty cells for aggregates", () => {
  const rows = [
    ["a", "2"],
    ["", "3"],
  ];
  const selection = new Set(["0:0", "0:1", "1:0", "1:1"]);
  const stats = computeSelectionStats(selection, rows);
  expect(stats.sum).toBe(5);
  expect(stats.min).toBe(2);
  expect(stats.max).toBe(3);
  expect(stats.avg).toBe(2.5);
});

describe("SelectionModel", () => {
  test("starts empty", () => {
    const model = new SelectionModel();
    expect(model.isEmpty()).toBe(true);
    expect(model.getCellCount()).toBe(0);
  });

  test("addCell adds a single cell", () => {
    const model = new SelectionModel();
    model.addCell(5, 10);
    expect(model.contains(5, 10)).toBe(true);
    expect(model.contains(5, 11)).toBe(false);
    expect(model.getCellCount()).toBe(1);
  });

  test("addRange adds a rectangular range", () => {
    const model = new SelectionModel();
    model.addRange(0, 2, 0, 1);
    expect(model.contains(0, 0)).toBe(true);
    expect(model.contains(1, 1)).toBe(true);
    expect(model.contains(2, 1)).toBe(true);
    expect(model.contains(3, 1)).toBe(false);
    expect(model.getCellCount()).toBe(6);
  });

  test("addRange normalizes coordinates", () => {
    const model = new SelectionModel();
    model.addRange(5, 3, 10, 8);
    expect(model.contains(3, 8)).toBe(true);
    expect(model.contains(5, 10)).toBe(true);
    expect(model.contains(4, 9)).toBe(true);
  });

  test("clear removes all ranges", () => {
    const model = new SelectionModel();
    model.addRange(0, 5, 0, 5);
    model.clear();
    expect(model.isEmpty()).toBe(true);
    expect(model.contains(2, 2)).toBe(false);
  });

  test("setRange replaces existing selection", () => {
    const model = new SelectionModel();
    model.addCell(1, 1);
    model.addCell(2, 2);
    model.setRange(10, 10, 10, 10);
    expect(model.contains(1, 1)).toBe(false);
    expect(model.contains(10, 10)).toBe(true);
    expect(model.getCellCount()).toBe(1);
  });

  test("removeCell removes single cell from range", () => {
    const model = new SelectionModel();
    model.addCell(5, 5);
    model.removeCell(5, 5);
    expect(model.contains(5, 5)).toBe(false);
    expect(model.isEmpty()).toBe(true);
  });

  test("toSet converts to Set format", () => {
    const model = new SelectionModel();
    model.addRange(0, 1, 0, 1);
    const set = model.toSet();
    expect(set.size).toBe(4);
    expect(set.has("0:0")).toBe(true);
    expect(set.has("0:1")).toBe(true);
    expect(set.has("1:0")).toBe(true);
    expect(set.has("1:1")).toBe(true);
  });

  test("fromSet creates model from Set", () => {
    const set = new Set(["0:0", "0:1", "1:0", "1:1"]);
    const model = SelectionModel.fromSet(set);
    expect(model.getCellCount()).toBe(4);
    expect(model.contains(0, 0)).toBe(true);
    expect(model.contains(1, 1)).toBe(true);
  });

  test("optimizes adjacent horizontal ranges", () => {
    const model = new SelectionModel();
    model.addRange(0, 0, 0, 0);
    model.addRange(0, 0, 1, 1);
    model.addRange(0, 0, 2, 2);
    expect(model.getCellCount()).toBe(3);
    expect(model.getRanges().length).toBeLessThanOrEqual(1);
  });

  test("optimizes adjacent vertical ranges", () => {
    const model = new SelectionModel();
    model.addRange(0, 0, 5, 5);
    model.addRange(1, 1, 5, 5);
    model.addRange(2, 2, 5, 5);
    expect(model.getCellCount()).toBe(3);
    expect(model.getRanges().length).toBeLessThanOrEqual(1);
  });

  test("handles large selection efficiently", () => {
    const model = new SelectionModel();
    model.addRange(0, 999, 0, 99);
    expect(model.getCellCount()).toBe(100000);
    expect(model.getRanges().length).toBe(1);
    expect(model.contains(500, 50)).toBe(true);
    expect(model.contains(1000, 50)).toBe(false);
  });

  test("computeSelectionStats works with SelectionModel", () => {
    const rows = [
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
    ];
    const model = new SelectionModel();
    model.addRange(0, 1, 0, 1);
    const stats = computeSelectionStats(model, rows);
    expect(stats.count).toBe(4);
    expect(stats.sum).toBe(12);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
  });
});
