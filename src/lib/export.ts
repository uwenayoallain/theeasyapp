import { parseSelectionKey } from "@/lib/selection";

export function selectionToTSV(
  selection: Set<string>,
  rows: string[][],
): string {
  if (selection.size === 0) return "";
  const coords = Array.from(selection)
    .map(parseSelectionKey)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const byRow = new Map<number, Map<number, string>>();
  for (const [r, c] of coords) {
    if (!byRow.has(r)) byRow.set(r, new Map());
    byRow.get(r)!.set(c, rows[r]?.[c] ?? "");
  }
  const lines: string[] = [];
  for (const colsMap of byRow.values()) {
    const colsSorted = Array.from(colsMap.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    lines.push(colsSorted.map(([, v]) => v).join("\t"));
  }
  return lines.join("\n");
}
