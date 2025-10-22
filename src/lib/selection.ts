export function parseSelectionKey(key: string): [number, number] {
  const [rowStr = "0", colStr = "0"] = key.split(":");
  return [Number.parseInt(rowStr, 10), Number.parseInt(colStr, 10)];
}

export interface SelectionRange {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

function normalizeRange(
  r1: number,
  r2: number,
  c1: number,
  c2: number,
): SelectionRange {
  return {
    r1: Math.min(r1, r2),
    r2: Math.max(r1, r2),
    c1: Math.min(c1, c2),
    c2: Math.max(c1, c2),
  };
}

export class SelectionModel {
  private ranges: SelectionRange[] = [];

  clear(): void {
    this.ranges = [];
  }

  isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  contains(row: number, col: number): boolean {
    return this.ranges.some(
      (r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2,
    );
  }

  addRange(r1: number, r2: number, c1: number, c2: number): void {
    const normalized = normalizeRange(r1, r2, c1, c2);
    this.ranges.push(normalized);
    this.optimize();
  }

  addCell(row: number, col: number): void {
    this.addRange(row, row, col, col);
  }

  removeCell(row: number, col: number): void {
    const newRanges: SelectionRange[] = [];
    for (const range of this.ranges) {
      if (
        row < range.r1 ||
        row > range.r2 ||
        col < range.c1 ||
        col > range.c2
      ) {
        newRanges.push(range);
        continue;
      }
      if (range.r1 === range.r2 && range.c1 === range.c2) {
        continue;
      }
      if (row === range.r1 && col === range.c1) {
        if (range.r1 === range.r2) {
          newRanges.push({ ...range, c1: range.c1 + 1 });
        } else if (range.c1 === range.c2) {
          newRanges.push({ ...range, r1: range.r1 + 1 });
        } else {
          newRanges.push(range);
        }
      } else {
        newRanges.push(range);
      }
    }
    this.ranges = newRanges;
  }

  setRange(r1: number, r2: number, c1: number, c2: number): void {
    this.clear();
    this.addRange(r1, r2, c1, c2);
  }

  getRanges(): readonly SelectionRange[] {
    return this.ranges;
  }

  getCellCount(): number {
    let count = 0;
    for (const r of this.ranges) {
      count += (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    }
    return count;
  }

  toSet(): Set<string> {
    const set = new Set<string>();
    for (const r of this.ranges) {
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          set.add(`${row}:${col}`);
        }
      }
    }
    return set;
  }

  static fromSet(set: Set<string>): SelectionModel {
    const model = new SelectionModel();
    for (const key of set) {
      const [r, c] = parseSelectionKey(key);
      model.addCell(r, c);
    }
    return model;
  }

  private optimize(): void {
    if (this.ranges.length <= 1) return;
    const merged: SelectionRange[] = [];
    const sorted = this.ranges.slice().sort((a, b) => {
      if (a.r1 !== b.r1) return a.r1 - b.r1;
      if (a.c1 !== b.c1) return a.c1 - b.c1;
      if (a.r2 !== b.r2) return a.r2 - b.r2;
      return a.c2 - b.c2;
    });

    let current = sorted[0];
    if (!current) return;

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (!next) continue;
      if (
        current.r1 === next.r1 &&
        current.r2 === next.r2 &&
        current.c2 + 1 >= next.c1
      ) {
        current = {
          r1: current.r1,
          r2: current.r2,
          c1: current.c1,
          c2: Math.max(current.c2, next.c2),
        };
      } else if (
        current.c1 === next.c1 &&
        current.c2 === next.c2 &&
        current.r2 + 1 >= next.r1
      ) {
        current = {
          r1: current.r1,
          r2: Math.max(current.r2, next.r2),
          c1: current.c1,
          c2: current.c2,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
    this.ranges = merged;
  }
}

export interface SelectionStats {
  count: number;
  rowsCount: number;
  colsCount: number;
  sum: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export function computeSelectionStats(
  selection: Set<string> | SelectionModel,
  rows: string[][],
): SelectionStats {
  if (selection instanceof SelectionModel) {
    return computeSelectionStatsFromModel(selection, rows);
  }

  const count = selection.size;
  if (count === 0) {
    return {
      count,
      rowsCount: 0,
      colsCount: 0,
      sum: null,
      avg: null,
      min: null,
      max: null,
    };
  }
  const rowsSet = new Set<number>();
  const colsSet = new Set<number>();
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let numericCount = 0;

  for (const key of selection) {
    const [r, c] = parseSelectionKey(key);
    rowsSet.add(r);
    colsSet.add(c);
    const v = rows[r]?.[c];
    if (v != null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) {
        sum += n;
        numericCount++;
        if (min === null || n < min) min = n;
        if (max === null || n > max) max = n;
      }
    }
  }

  const avg = numericCount > 0 ? sum / numericCount : null;
  return {
    count,
    rowsCount: rowsSet.size,
    colsCount: colsSet.size,
    sum: numericCount > 0 ? sum : null,
    avg,
    min,
    max,
  };
}

function computeSelectionStatsFromModel(
  selection: SelectionModel,
  rows: string[][],
): SelectionStats {
  const count = selection.getCellCount();
  if (count === 0) {
    return {
      count,
      rowsCount: 0,
      colsCount: 0,
      sum: null,
      avg: null,
      min: null,
      max: null,
    };
  }

  const rowsSet = new Set<number>();
  const colsSet = new Set<number>();
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let numericCount = 0;

  for (const range of selection.getRanges()) {
    for (let r = range.r1; r <= range.r2; r++) {
      rowsSet.add(r);
      for (let c = range.c1; c <= range.c2; c++) {
        colsSet.add(c);
        const v = rows[r]?.[c];
        if (v != null && v !== "") {
          const n = Number(v);
          if (!Number.isNaN(n)) {
            sum += n;
            numericCount++;
            if (min === null || n < min) min = n;
            if (max === null || n > max) max = n;
          }
        }
      }
    }
  }

  const avg = numericCount > 0 ? sum / numericCount : null;
  return {
    count,
    rowsCount: rowsSet.size,
    colsCount: colsSet.size,
    sum: numericCount > 0 ? sum : null,
    avg,
    min,
    max,
  };
}
