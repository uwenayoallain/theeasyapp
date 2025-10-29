import {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ColumnDef } from "@/lib/csv";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { recordCommit } from "@/lib/perf";
import { selectionToTSV } from "@/lib/export";
import { clamp } from "@/lib/math-utils";

interface SelectedCell {
  row: number;
  col: number;
}

interface FocusCellRequest {
  row: number;
  col: number;
  id: string;
}

type SortState = { colIndex: number; dir: "asc" | "desc" } | null;

interface DataGridProps {
  columns: ColumnDef[];
  rows: string[][];
  rowHeight: number;
  onSelectionChange?: (selection: Set<string>) => void;
  onColumnsResize?: (cols: ColumnDef[]) => void;
  onHeaderClick?: (colIndex: number) => void;
  onEditCell?: (row: number, col: number, value: string) => void;
  onPaste?: (startRow: number, startCol: number, values: string[][]) => void;
  onClear?: (cells: Array<{ row: number; col: number }>) => void;
  onFocusFilter?: () => void;
  onSearchShortcut?: () => void;
  currentSearchKey?: string | null;
  searchQuery?: string;
  focusCellRequest?: FocusCellRequest | null;
  sortState?: SortState;
  filtersRow?: ReactNode;
  filtersHeight?: number;
  headerHeight?: number;
  totalRows?: number;
  onRangeChange?: (range: { startIndex: number; endIndex: number }) => void;
}

export function DataGrid({
  columns,
  rows,
  rowHeight,
  onSelectionChange,
  onColumnsResize,
  onHeaderClick,
  onEditCell,
  onPaste,
  onClear,
  onFocusFilter,
  onSearchShortcut,
  currentSearchKey,
  searchQuery,
  focusCellRequest,
  sortState,
  filtersRow,
  filtersHeight = 32,
  headerHeight = 32,
  totalRows,
  onRangeChange,
}: DataGridProps) {
  const [anchorCell, setAnchorCell] = useState<SelectedCell | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(
    () => new Set(),
  );
  const [menu, setMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    cell: SelectedCell | null;
  }>(() => ({ open: false, x: 0, y: 0, cell: null }));
  const totalRowCount =
    typeof totalRows === "number" ? Math.max(0, totalRows) : rows.length;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack's virtualizer returns imperative helpers; we confine them to this module.
  const rowVirtual = useVirtualizer({
    count: totalRowCount,
    getScrollElement: () => document.getElementById("grid-scroll")!,
    estimateSize: () => rowHeight,
    overscan: 4,
  });
  const virtualRows = rowVirtual.getVirtualItems();
  const firstVisibleIndex =
    virtualRows.length > 0 ? virtualRows[0]!.index : null;
  const lastVisibleIndex =
    virtualRows.length > 0 ? virtualRows[virtualRows.length - 1]!.index : null;

  const renderStart = useRef(performance.now());

  useEffect(() => {
    renderStart.current = performance.now();
  });

  useEffect(() => {
    recordCommit("DataGrid", renderStart.current, {
      visibleRows: virtualRows.length,
    });
  }, [virtualRows.length]);

  useEffect(() => {
    if (firstVisibleIndex == null || lastVisibleIndex == null) return;
    onRangeChange?.({
      startIndex: firstVisibleIndex,
      endIndex: lastVisibleIndex,
    });
  }, [firstVisibleIndex, lastVisibleIndex, onRangeChange]);

  const keyFor = useCallback(
    (rowIndex: number, colIndex: number) => `${rowIndex}:${colIndex}`,
    [],
  );

  const parseSelectionKey = useCallback((key: string): [number, number] => {
    const [rowStr = "0", colStr = "0"] = key.split(":");
    return [Number.parseInt(rowStr, 10), Number.parseInt(colStr, 10)];
  }, []);

  const [focusCell, setFocusCell] = useState<SelectedCell | null>(null);
  const [editing, setEditing] = useState<{
    row: number;
    col: number;
    value: string;
  } | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);

  const applySelection = useCallback(
    (
      nextSelection: Set<string>,
      options?: { anchor?: SelectedCell | null; focus?: SelectedCell | null },
    ) => {
      setSelectedCells(nextSelection);
      onSelectionChange?.(nextSelection);
      if (options?.anchor !== undefined) {
        setAnchorCell(options.anchor);
      }
      if (options?.focus !== undefined) {
        setFocusCell(options.focus);
      }
    },
    [onSelectionChange],
  );

  const handleCellClick = useCallback(
    (
      rowIndex: number,
      colIndex: number,
      e?: ReactMouseEvent<HTMLDivElement>,
    ) => {
      const nextAnchor: SelectedCell = { row: rowIndex, col: colIndex };

      if (e?.shiftKey && anchorCell) {
        const r1 = Math.min(anchorCell.row, rowIndex);
        const r2 = Math.max(anchorCell.row, rowIndex);
        const c1 = Math.min(anchorCell.col, colIndex);
        const c2 = Math.max(anchorCell.col, colIndex);
        const next = new Set<string>();
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            next.add(keyFor(r, c));
          }
        }
        applySelection(next, { focus: nextAnchor });
        return;
      }

      if (e && (e.metaKey || e.ctrlKey)) {
        setSelectedCells((prev) => {
          const next = new Set(prev);
          const k = keyFor(rowIndex, colIndex);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          onSelectionChange?.(next);
          return next;
        });
        setAnchorCell(nextAnchor);
        setFocusCell(nextAnchor);
        return;
      }

      const next = new Set([keyFor(rowIndex, colIndex)]);
      applySelection(next, { anchor: nextAnchor, focus: nextAnchor });
    },
    [anchorCell, applySelection, keyFor, onSelectionChange],
  );

  const handleContextMenu = useCallback(
    (
      rowIndex: number,
      colIndex: number,
      e: ReactMouseEvent<HTMLDivElement>,
    ) => {
      e.preventDefault();
      const cell = { row: rowIndex, col: colIndex };
      const k = keyFor(rowIndex, colIndex);
      if (!selectedCells.has(k)) {
        const next = new Set([k]);
        applySelection(next, { anchor: cell, focus: cell });
      } else {
        setAnchorCell(cell);
        setFocusCell(cell);
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.min(e.clientX, vw - 8);
      const y = Math.min(e.clientY, vh - 8);
      setMenu({ open: true, x, y, cell });
    },
    [applySelection, keyFor, selectedCells],
  );

  const closeMenu = useCallback(
    () => setMenu((m) => ({ ...m, open: false })),
    [],
  );

  const copyCell = useCallback(() => {
    if (!menu.cell) return;
    const val = rows[menu.cell.row]?.[menu.cell.col] ?? "";
    navigator.clipboard?.writeText(val);
    closeMenu();
  }, [closeMenu, menu.cell, rows]);

  const copySelection = useCallback(() => {
    if (selectedCells.size === 0) return;
    const text = selectionToTSV(selectedCells, rows);
    navigator.clipboard?.writeText(text);
    closeMenu();
  }, [closeMenu, rows, selectedCells]);

  const ensureVisible = useCallback(
    (targetRow: number) => {
      if (targetRow < 0 || targetRow >= totalRowCount) return;
      rowVirtual.scrollToIndex(targetRow, { align: "auto" });
    },
    [rowVirtual, totalRowCount],
  );

  const lastFocusRequestRef = useRef<{
    id: string | null;
    row: number;
    col: number;
    columnsLength: number;
    totalRows: number;
  } | null>(null);

  const focusRow = focusCellRequest?.row ?? null;
  const focusCol = focusCellRequest?.col ?? null;
  const focusId = focusCellRequest?.id ?? null;

  useEffect(() => {
    if (
      focusRow == null ||
      focusCol == null ||
      focusId == null ||
      columns.length === 0 ||
      totalRowCount === 0
    ) {
      if (focusId == null) lastFocusRequestRef.current = null;
      return;
    }

    const context = {
      id: focusId,
      row: focusRow,
      col: focusCol,
      columnsLength: columns.length,
      totalRows: totalRowCount,
    };

    const last = lastFocusRequestRef.current;
    if (
      last &&
      last.id === context.id &&
      last.row === context.row &&
      last.col === context.col &&
      last.columnsLength === context.columnsLength &&
      last.totalRows === context.totalRows
    ) {
      return;
    }
    lastFocusRequestRef.current = context;

    const safeRow = Math.min(
      Math.max(context.row, 0),
      Math.max(0, context.totalRows - 1),
    );
    const safeCol = Math.min(Math.max(context.col, 0), columns.length - 1);
    ensureVisible(safeRow);
    const key = keyFor(safeRow, safeCol);
    const next = new Set([key]);
    const anchor = { row: safeRow, col: safeCol };
    applySelection(next, { anchor, focus: anchor });
    setEditing(null);
  }, [
    focusId,
    focusRow,
    focusCol,
    applySelection,
    columns.length,
    totalRowCount,
    ensureVisible,
    keyFor,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (columns.length === 0 || totalRowCount === 0) return;
      if (!focusCell && anchorCell) setFocusCell(anchorCell);
      const cur = focusCell ?? anchorCell ?? { row: 0, col: 0 };
      const next = { ...cur };
      const lastRow = Math.max(0, totalRowCount - 1);
      const lastCol = columns.length - 1;

      const extend = e.shiftKey;
      const mod = e.metaKey || e.ctrlKey;

      if (editing) {
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(null);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onEditCell?.(editing.row, editing.col, editing.value);
          const down = clamp(editing.row + (e.shiftKey ? -1 : 1), 0, lastRow);
          setEditing(null);
          setFocusCell({ row: down, col: editing.col });
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onEditCell?.(editing.row, editing.col, editing.value);
          const right = clamp(editing.col + (e.shiftKey ? -1 : 1), 0, lastCol);
          setEditing(null);
          setFocusCell({ row: editing.row, col: right });
          return;
        }
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          next.row = clamp(mod ? 0 : cur.row - 1, 0, lastRow);
          break;
        case "ArrowDown":
          e.preventDefault();
          next.row = clamp(mod ? lastRow : cur.row + 1, 0, lastRow);
          break;
        case "ArrowLeft":
          e.preventDefault();
          next.col = clamp(mod ? 0 : cur.col - 1, 0, lastCol);
          break;
        case "ArrowRight":
          e.preventDefault();
          next.col = clamp(mod ? lastCol : cur.col + 1, 0, lastCol);
          break;
        case "Home":
          e.preventDefault();
          next.col = 0;
          if (mod) next.row = 0;
          break;
        case "End":
          e.preventDefault();
          next.col = lastCol;
          if (mod) next.row = lastRow;
          break;
        case "PageUp":
          e.preventDefault();
          next.row = clamp(cur.row - 20, 0, lastRow);
          break;
        case "PageDown":
          e.preventDefault();
          next.row = clamp(cur.row + 20, 0, lastRow);
          break;
        case "Enter":
          e.preventDefault();
          setEditing({
            row: cur.row,
            col: cur.col,
            value: rows[cur.row]?.[cur.col] ?? "",
          });
          return;
        case "Tab":
          e.preventDefault();
          next.col = clamp(cur.col + (e.shiftKey ? -1 : 1), 0, lastCol);
          break;
        case "F2":
          e.preventDefault();
          setEditing({
            row: cur.row,
            col: cur.col,
            value: rows[cur.row]?.[cur.col] ?? "",
          });
          return;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          if (selectedCells.size > 0) {
            const cells = Array.from(selectedCells).map((key) => {
              const [r, c] = parseSelectionKey(key);
              return { row: r, col: c };
            });
            onClear?.(cells);
          } else {
            onClear?.([{ row: cur.row, col: cur.col }]);
          }
          return;
        }
        case "Escape": {
          e.preventDefault();
          if (selectedCells.size > 0) {
            const empty = new Set<string>();
            applySelection(empty, { anchor: null, focus: null });
          }
          setEditing(null);
          return;
        }
        case "f":
        case "F":
          if (mod) {
            e.preventDefault();
            if (e.shiftKey) onFocusFilter?.();
            else onSearchShortcut?.();
            return;
          }
          break;
        case " ": {
          if (e.shiftKey && !mod) {
            e.preventDefault();
            const nextSel = new Set<string>();
            for (let c = 0; c <= lastCol; c++) nextSel.add(keyFor(cur.row, c));
            applySelection(nextSel, {
              anchor: { row: cur.row, col: 0 },
              focus: cur,
            });
            return;
          }
          if (mod && !e.shiftKey) {
            e.preventDefault();
            const nextSel = new Set<string>();
            for (const v of virtualRows) nextSel.add(keyFor(v.index, cur.col));
            applySelection(nextSel, { anchor: cur, focus: cur });
            return;
          }
          break;
        }
        case "a":
        case "A":
          if (mod) {
            e.preventDefault();
            const nextSel = new Set<string>();
            for (const v of virtualRows) {
              for (let c = 0; c <= lastCol; c++)
                nextSel.add(keyFor(v.index, c));
            }
            applySelection(nextSel, { anchor: cur, focus: cur });
            return;
          }
          break;
        case "v":
        case "V":
          if (mod) {
            e.preventDefault();
            navigator.clipboard
              ?.readText()
              .then((text) => {
                const rowsText = text.replace(/\r/g, "").split("\n");
                const values = rowsText.map((line) => line.split("\t"));
                onPaste?.(cur.row, cur.col, values);
              })
              .catch((err) => {
                console.warn(
                  "DataGrid: failed to read clipboard contents",
                  err,
                );
              });
            return;
          }
          break;
        case "x":
        case "X":
          if (mod) {
            e.preventDefault();
            const cells = Array.from(selectedCells).map((key) => {
              const [r, c] = parseSelectionKey(key);
              return { row: r, col: c };
            });
            const before = document.activeElement as HTMLElement | null;
            copySelection();
            onClear?.(cells);
            before?.focus();
            return;
          }
          break;
        case "c":
        case "C":
          if (mod) {
            e.preventDefault();
            copySelection();
            return;
          }
          break;
        default:
          return;
      }

      ensureVisible(next.row);
      setFocusCell(next);

      if (extend && anchorCell) {
        const startRow = Math.max(0, Math.min(anchorCell.row, next.row));
        const endRow = Math.min(
          Math.max(anchorCell.row, next.row),
          Math.max(0, totalRowCount - 1),
        );
        const startCol = Math.max(0, Math.min(anchorCell.col, next.col));
        const endCol = Math.min(
          Math.max(anchorCell.col, next.col),
          Math.max(columns.length - 1, 0),
        );
        const nextSel = new Set<string>();
        for (let r = startRow; r <= endRow; r++) {
          for (let c = startCol; c <= endCol; c++) nextSel.add(keyFor(r, c));
        }
        applySelection(nextSel, { focus: next });
      } else {
        const single = new Set([keyFor(next.row, next.col)]);
        applySelection(single, { anchor: next, focus: next });
      }
    },
    [
      anchorCell,
      applySelection,
      columns,
      copySelection,
      editing,
      ensureVisible,
      focusCell,
      keyFor,
      onClear,
      onEditCell,
      onFocusFilter,
      onPaste,
      onSearchShortcut,
      parseSelectionKey,
      rows,
      selectedCells,
      totalRowCount,
      virtualRows,
    ],
  );

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        const input = editorRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      });
    }
  }, [editing]);

  return (
    <div
      id="grid-scroll"
      role="grid"
      aria-label="CSV data grid"
      aria-rowcount={columns.length > 0 ? totalRowCount + 1 : totalRowCount}
      aria-colcount={columns.length}
      aria-multiselectable="true"
      className="relative h-full overflow-auto focus:outline-none select-none bg-background"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => e.preventDefault()}
      onPaste={(e) => {
        if (!focusCell && !anchorCell) return;
        const cur = focusCell ?? anchorCell!;
        const text = e.clipboardData?.getData("text/plain");
        if (!text) return;
        e.preventDefault();
        const rowsText = text.replace(/\r/g, "").split("\n");
        const values = rowsText.map((line) => line.split("\t"));
        onPaste?.(cur.row, cur.col, values);
      }}
    >
      {columns.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-muted-foreground text-sm">Loading data...</div>
        </div>
      )}

      <div
        style={{
          height: rowVirtual.getTotalSize(),
          position: "relative",
          minHeight: 0,
        }}
      >
        <Header
          columns={columns}
          onColumnsResize={onColumnsResize}
          onHeaderClick={onHeaderClick}
          sortState={sortState ?? null}
        />
        {filtersRow && (
          <div
            className="sticky z-10 bg-background/90 backdrop-blur border-b px-1 py-0.5 grid gap-1"
            style={{
              top: headerHeight,
              gridTemplateColumns: columns
                .map((c) => `${c.width ?? 160}px`)
                .join(" "),
            }}
          >
            {filtersRow}
          </div>
        )}
        {virtualRows.map((vRow) => (
          <Row
            key={vRow.key}
            index={vRow.index}
            top={vRow.start + headerHeight + (filtersRow ? filtersHeight : 0)}
            height={vRow.size}
            columns={columns}
            row={rows[vRow.index]}
            selectedCells={selectedCells}
            onCellClick={handleCellClick}
            onCellContextMenu={handleContextMenu}
            onCellDoubleClick={(r, c) =>
              setEditing({ row: r, col: c, value: rows[r]?.[c] ?? "" })
            }
            editing={editing}
            setEditing={setEditing}
            editorRef={editorRef}
            currentSearchKey={currentSearchKey ?? null}
            searchQuery={searchQuery ?? ""}
            onEditCell={onEditCell}
          />
        ))}
        <ContextMenu open={menu.open} x={menu.x} y={menu.y} onClose={closeMenu}>
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Cell actions
          </div>
          <ContextMenuItem onSelect={copyCell}>Copy cell</ContextMenuItem>
          <ContextMenuItem
            onSelect={copySelection}
            disabled={selectedCells.size <= 1}
          >
            Copy selection (TSV)
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!menu.cell) return;
                const lines = text.replace(/\r/g, "").split("\n");
                const values = lines.map((l) => l.split("\t"));
                onPaste?.(menu.cell.row, menu.cell.col, values);
              } catch (err) {
                console.warn("DataGrid: clipboard paste failed", err);
              }
              closeMenu();
            }}
          >
            Paste
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              if (!menu.cell) return;
              onClear?.([{ row: menu.cell.row, col: menu.cell.col }]);
              closeMenu();
            }}
          >
            Clear cell
          </ContextMenuItem>
          <ContextMenuSeparator />
          {typeof onHeaderClick === "function" && menu.cell && (
            <>
              <ContextMenuItem
                onSelect={() => {
                  onHeaderClick(menu.cell!.col);
                  closeMenu();
                }}
              >
                Sort (cycle)
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  const col = menu.cell!.col;
                  const visible = virtualRows;
                  const sample = visible
                    .slice(0, 100)
                    .map((v) => rows[v.index]?.[col] ?? "");
                  const ctx = document.createElement("canvas").getContext("2d");
                  const font = getComputedStyle(document.body).font;
                  if (ctx && font) ctx.font = font;
                  const measure = (s: string) =>
                    ctx
                      ? Math.ceil(ctx.measureText(s).width) + 24
                      : Math.max(160, s.length * 8 + 24);
                  const targetColumn = columns[col];
                  if (!targetColumn) {
                    closeMenu();
                    return;
                  }
                  const max = Math.max(
                    measure(targetColumn.name),
                    ...sample.map(measure),
                  );
                  const next = columns.slice();
                  next[col] = {
                    ...targetColumn,
                    width: Math.min(Math.max(60, max), 600),
                  };
                  onColumnsResize?.(next);
                  closeMenu();
                }}
              >
                Autosize column
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={closeMenu}>Close</ContextMenuItem>
        </ContextMenu>
      </div>
    </div>
  );
}

const Header = memo(function Header({
  columns,
  onColumnsResize,
  onHeaderClick,
  sortState,
}: {
  columns: ColumnDef[];
  onColumnsResize?: (cols: ColumnDef[]) => void;
  onHeaderClick?: (i: number) => void;
  sortState: SortState;
}) {
  if (columns.length === 0) return null;

  return (
    <div
      className="sticky top-0 z-20 bg-card border-b grid select-none"
      role="row"
      aria-rowindex={1}
      style={{
        gridTemplateColumns: columns
          .map((c) => `${c.width ?? 160}px`)
          .join(" "),
      }}
    >
      {columns.map((c, i) => (
        <div
          key={i}
          role="columnheader"
          aria-sort={
            sortState && sortState.colIndex === i
              ? sortState.dir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
          className="px-2 py-1 text-sm font-medium truncate border-r last:border-r-0 relative group cursor-pointer select-none"
          onClick={() => onHeaderClick?.(i)}
        >
          {c.name}
          {onColumnsResize && (
            <span
              role="separator"
              aria-label="Resize column"
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-transparent group-hover:bg-primary/20"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = c.width ?? 160;
                const next = columns.slice();
                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const currentColumn = next[i];
                  if (!currentColumn) return;
                  next[i] = {
                    ...currentColumn,
                    width: Math.max(60, startWidth + dx),
                  };
                  onColumnsResize(next);
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
});

function highlightValue(value: string, query: string): ReactNode {
  if (!query) return value;
  if (!value) return value;
  const lower = value.toLowerCase();
  const target = query.toLowerCase();
  if (!lower.includes(target)) return value;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lower.indexOf(target);
  let token = 0;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(value.slice(cursor, matchIndex));
    }
    const matched = value.slice(matchIndex, matchIndex + query.length);
    parts.push(
      <mark
        key={`highlight-${token++}`}
        className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-400/30"
      >
        {matched}
      </mark>,
    );
    cursor = matchIndex + query.length;
    matchIndex = lower.indexOf(target, cursor);
  }

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return parts;
}

const Row = memo(function Row({
  index,
  top,
  height,
  columns,
  row,
  selectedCells,
  onCellClick,
  onCellContextMenu,
  onCellDoubleClick,
  editing,
  setEditing,
  editorRef,
  currentSearchKey,
  searchQuery,
  onEditCell,
}: {
  index: number;
  top: number;
  height: number;
  columns: ColumnDef[];
  row?: string[];
  selectedCells: Set<string>;
  onCellClick: (
    rowIndex: number,
    colIndex: number,
    e?: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onCellContextMenu: (
    rowIndex: number,
    colIndex: number,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onCellDoubleClick: (rowIndex: number, colIndex: number) => void;
  editing: { row: number; col: number; value: string } | null;
  setEditing: (v: { row: number; col: number; value: string } | null) => void;
  editorRef: React.RefObject<HTMLInputElement | null>;
  currentSearchKey: string | null;
  searchQuery: string;
  onEditCell?: (row: number, col: number, value: string) => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      className="absolute left-0 right-0 grid border-b select-none bg-card"
      style={{
        transform: `translateY(${top}px)`,
        height,
        gridTemplateColumns: columns
          .map((c) => `${c.width ?? 160}px`)
          .join(" "),
        contain: "content",
      }}
    >
      {columns.map((_, i) => {
        const cellKey = `${index}:${i}`;
        const isSelected = selectedCells.has(cellKey);
        const isEditing = !!(
          editing &&
          editing.row === index &&
          editing.col === i
        );
        const cellValue = row?.[i] ?? "";
        const isMatch = !!(
          searchQuery &&
          cellValue &&
          cellValue.toLowerCase().includes(searchQuery.toLowerCase())
        );
        const isCurrentMatch = currentSearchKey === cellKey;
        const displayValue = !isEditing
          ? isMatch && searchQuery
            ? highlightValue(cellValue, searchQuery)
            : cellValue
          : null;
        return (
          <div
            key={i}
            role="gridcell"
            aria-colindex={i + 1}
            aria-selected={isSelected}
            className={cn(
              "px-2 py-1 text-sm truncate border-r last:border-r-0 cursor-pointer transition-colors select-none relative",
              isSelected
                ? "bg-primary/20 ring-2 ring-primary ring-inset"
                : "hover:bg-muted/50",
              isMatch && !isSelected && "bg-amber-100/60 dark:bg-amber-400/20",
              isCurrentMatch &&
                "outline outline-2 outline-amber-500 outline-offset-[-2px]",
            )}
            style={{ contain: "content" }}
            draggable={false}
            onClick={(e) => onCellClick(index, i, e)}
            onContextMenu={(e) => onCellContextMenu(index, i, e)}
            onDoubleClick={() => onCellDoubleClick(index, i)}
          >
            {!isEditing && displayValue}
            {isEditing && (
              <Input
                ref={editorRef}
                defaultValue={editing.value}
                onBlur={(e) => {
                  const nextVal = e.currentTarget.value;
                  onEditCell?.(index, i, nextVal);
                  setEditing(null);
                }}
                onChange={(e) =>
                  setEditing({ row: index, col: i, value: e.target.value })
                }
                className="absolute inset-0 m-0 h-full w-full rounded-none border-2 border-primary bg-background px-2 py-1 text-sm shadow-none focus-visible:ring-0"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
