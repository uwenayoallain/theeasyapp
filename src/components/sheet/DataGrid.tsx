import { memo, useState, useCallback, useRef, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ColumnDef } from "@/lib/csv";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";

interface SelectedCell {
  row: number;
  col: number;
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
}: {
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
}) {
  const [anchorCell, setAnchorCell] = useState<SelectedCell | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; cell: SelectedCell | null }>(
    () => ({ open: false, x: 0, y: 0, cell: null })
  );

  const rowVirtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => document.getElementById("grid-scroll")!,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const keyFor = useCallback((rowIndex: number, colIndex: number) => `${rowIndex}:${colIndex}`, []);

  const handleCellClick = useCallback(
    (rowIndex: number, colIndex: number, e?: ReactMouseEvent<HTMLDivElement>) => {
      const nextAnchor: SelectedCell = { row: rowIndex, col: colIndex };

      // Shift: select rectangular range from anchor to current
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
        setSelectedCells(next);
        onSelectionChange?.(next);
        setAnchorCell(nextAnchor);
        return;
      }

      // Ctrl/Cmd: toggle clicked cell
      if (e && (e.metaKey || e.ctrlKey)) {
        setSelectedCells(prev => {
          const next = new Set(prev);
          const k = keyFor(rowIndex, colIndex);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          onSelectionChange?.(next);
          return next;
        });
        setAnchorCell(nextAnchor);
        return;
      }

      // Default: single selection
      const next = new Set([keyFor(rowIndex, colIndex)]);
      setSelectedCells(next);
      onSelectionChange?.(next);
      setAnchorCell(nextAnchor);
    },
    [anchorCell, keyFor]
  );

  const handleContextMenu = useCallback(
    (rowIndex: number, colIndex: number, e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const cell = { row: rowIndex, col: colIndex };
      const k = keyFor(rowIndex, colIndex);
      // If right-clicked cell is not in selection, select it
      if (!selectedCells.has(k)) {
        const next = new Set([k]);
        setSelectedCells(next);
        onSelectionChange?.(next);
        setAnchorCell(cell);
      }
      // Position menu, clamped to viewport bounds
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.min(e.clientX, vw - 8);
      const y = Math.min(e.clientY, vh - 8);
      setMenu({ open: true, x, y, cell });
    },
    [keyFor, onSelectionChange, selectedCells]
  );

  const closeMenu = useCallback(() => setMenu(m => ({ ...m, open: false })), []);

  const copyCell = useCallback(() => {
    if (!menu.cell) return;
    const val = rows[menu.cell.row]?.[menu.cell.col] ?? "";
    navigator.clipboard?.writeText(val);
    closeMenu();
  }, [closeMenu, menu.cell, rows]);

  const copySelection = useCallback(() => {
    if (selectedCells.size === 0) return;
    // Build TSV by scanning selected cells in row-major order
    const coords = Array.from(selectedCells)
      .map(k => k.split(":").map(n => parseInt(n, 10)) as [number, number])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const byRow = new Map<number, Map<number, string>>();
    for (const [r, c] of coords) {
      if (!byRow.has(r)) byRow.set(r, new Map());
      byRow.get(r)!.set(c, rows[r]?.[c] ?? "");
    }
    const lines: string[] = [];
    for (const [r, colsMap] of byRow.entries()) {
      const colsSorted = Array.from(colsMap.entries()).sort((a, b) => a[0] - b[0]);
      lines.push(colsSorted.map(([, v]) => v).join("\t"));
    }
    const text = lines.join("\n");
    navigator.clipboard?.writeText(text);
    closeMenu();
  }, [closeMenu, rows, selectedCells]);

  // Show empty state when no data
  if (columns.length === 0) {
    return (
      <div id="grid-scroll" className="h-full overflow-auto flex items-center justify-center select-none focus:outline-none" tabIndex={0}>
        <div className="text-muted-foreground text-sm">
          Loading data...
        </div>
      </div>
    );
  }

  const [focusCell, setFocusCell] = useState<SelectedCell | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const editorRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback((v: number, min: number, max: number) => Math.max(min, Math.min(max, v)), []);

  const ensureVisible = useCallback((targetRow: number) => {
    const v = rowVirtual;
    if (targetRow < 0 || targetRow >= rows.length) return;
    v.scrollToIndex(targetRow, { align: "auto" });
  }, [rowVirtual, rows.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (columns.length === 0 || rows.length === 0) return;
    if (!focusCell && anchorCell) setFocusCell(anchorCell);
    const cur = focusCell ?? anchorCell ?? { row: 0, col: 0 };
    let next = { ...cur };
    const lastRow = rows.length - 1;
    const lastCol = columns.length - 1;

    const extend = e.shiftKey;
    const mod = e.metaKey || e.ctrlKey;

    // If editing, handle commit/cancel/navigation for editor
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
        next.row = clamp(cur.row - 1, 0, lastRow);
        break;
      case "ArrowDown":
        e.preventDefault();
        next.row = clamp(cur.row + 1, 0, lastRow);
        break;
      case "ArrowLeft":
        e.preventDefault();
        next.col = clamp(cur.col - 1, 0, lastCol);
        break;
      case "ArrowRight":
        e.preventDefault();
        next.col = clamp(cur.col + 1, 0, lastCol);
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
        setEditing({ row: cur.row, col: cur.col, value: rows[cur.row]?.[cur.col] ?? "" });
        return;
      case "Tab":
        e.preventDefault();
        next.col = clamp(cur.col + (e.shiftKey ? -1 : 1), 0, lastCol);
        break;
      case "F2":
        e.preventDefault();
        setEditing({ row: cur.row, col: cur.col, value: rows[cur.row]?.[cur.col] ?? "" });
        return;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        if (selectedCells.size > 0) {
          const cells = Array.from(selectedCells).map(k => {
            const [r, c] = k.split(":").map(n => parseInt(n, 10));
            return { row: r, col: c };
          });
          onClear?.(cells);
        } else {
          onClear?.([{ row: cur.row, col: cur.col }]);
        }
        return;
      }
      case "f":
      case "F":
        if (mod) {
          e.preventDefault();
          onFocusFilter?.();
          return;
        }
        break;
      case "v":
      case "V":
        if (mod) {
          e.preventDefault();
          navigator.clipboard?.readText().then(text => {
            const rowsText = text.replace(/\r/g, "").split("\n");
            const values = rowsText.map(line => line.split("\t"));
            onPaste?.(cur.row, cur.col, values);
          }).catch(() => {});
          return;
        }
        break;
      case "x":
      case "X":
        if (mod) {
          e.preventDefault();
          const cells = Array.from(selectedCells).map(k => {
            const [r, c] = k.split(":").map(n => parseInt(n, 10));
            return { row: r, col: c };
          });
          // Copy then clear (cut)
          const before = document.activeElement as HTMLElement | null;
          // Reuse copySelection
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
      const r1 = Math.min(anchorCell.row, next.row);
      const r2 = Math.max(anchorCell.row, next.row);
      const c1 = Math.min(anchorCell.col, next.col);
      const c2 = Math.max(anchorCell.col, next.col);
      const nextSel = new Set<string>();
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) nextSel.add(keyFor(r, c));
      }
      setSelectedCells(nextSel);
      onSelectionChange?.(nextSel);
    } else {
      const single = new Set([keyFor(next.row, next.col)]);
      setSelectedCells(single);
      onSelectionChange?.(single);
      setAnchorCell(next);
    }
  }, [anchorCell, columns.length, copySelection, ensureVisible, keyFor, onSelectionChange, rows.length, focusCell, clamp, editing, onEditCell, onPaste, onClear, onFocusFilter, selectedCells.size]);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => editorRef.current?.focus());
  }, [editing]);

  return (
    <div
      id="grid-scroll"
      className="h-full overflow-auto focus:outline-none select-none"
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
        const values = rowsText.map(line => line.split("\t"));
        onPaste?.(cur.row, cur.col, values);
      }}
    >
      <div style={{ height: rowVirtual.getTotalSize(), position: "relative" }}>
        <Header columns={columns} onColumnsResize={onColumnsResize} onHeaderClick={onHeaderClick} />
        {rowVirtual.getVirtualItems().map(vRow => (
          <Row
            key={vRow.key}
            index={vRow.index}
            top={vRow.start + 32}
            height={vRow.size}
            columns={columns}
            row={rows[vRow.index]}
            selectedCells={selectedCells}
            onCellClick={handleCellClick}
            onCellContextMenu={handleContextMenu}
            onCellDoubleClick={(r, c) => setEditing({ row: r, col: c, value: rows[r]?.[c] ?? "" })}
            editing={editing}
            setEditing={setEditing}
            editorRef={editorRef}
          />
        ))}
        <ContextMenu open={menu.open} x={menu.x} y={menu.y} onClose={closeMenu}>
          <div className="px-2 py-1 text-xs text-muted-foreground">Cell actions</div>
          <ContextMenuItem onSelect={copyCell}>Copy cell</ContextMenuItem>
          <ContextMenuItem onSelect={copySelection} disabled={selectedCells.size <= 1}>
            Copy selection (TSV)
          </ContextMenuItem>
          <ContextMenuItem onSelect={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (!menu.cell) return;
              const lines = text.replace(/\r/g, "").split("\n");
              const values = lines.map(l => l.split("\t"));
              onPaste?.(menu.cell.row, menu.cell.col, values);
            } catch {}
            closeMenu();
          }}>Paste</ContextMenuItem>
          <ContextMenuItem onSelect={() => {
            if (!menu.cell) return;
            onClear?.([{ row: menu.cell.row, col: menu.cell.col }]);
            closeMenu();
          }}>Clear cell</ContextMenuItem>
          <ContextMenuSeparator />
          {typeof onHeaderClick === 'function' && menu.cell && (
            <>
              <ContextMenuItem onSelect={() => { onHeaderClick(menu.cell!.col); closeMenu(); }}>Sort (cycle)</ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                const col = menu.cell!.col;
                const visible = rowVirtual.getVirtualItems();
                const sample = visible.slice(0, 100).map(v => rows[v.index]?.[col] ?? "");
                const ctx = document.createElement('canvas').getContext('2d');
                const font = getComputedStyle(document.body).font;
                if (ctx && font) ctx.font = font;
                const measure = (s: string) => ctx ? Math.ceil(ctx.measureText(s).width) + 24 : Math.max(160, s.length * 8 + 24);
                const max = Math.max(measure(columns[col]?.name ?? ''), ...sample.map(measure));
                const next = columns.slice();
                next[col] = { ...next[col], width: Math.min(Math.max(60, max), 600) };
                onColumnsResize?.(next);
                closeMenu();
              }}>Autosize column</ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={closeMenu}>Close</ContextMenuItem>
        </ContextMenu>
      </div>
    </div>
  );
}

const Header = memo(function Header({ columns, onColumnsResize, onHeaderClick }: { columns: ColumnDef[]; onColumnsResize?: (cols: ColumnDef[]) => void; onHeaderClick?: (i: number) => void }) {
  if (columns.length === 0) return null;

  return (
    <div className="sticky top-0 z-20 bg-card border-b grid select-none" style={{ gridTemplateColumns: columns.map(c => `${c.width ?? 160}px`).join(" ") }}>
      {columns.map((c, i) => (
        <div key={i} className="px-2 py-1 text-sm font-medium truncate border-r last:border-r-0 relative group cursor-pointer select-none" onClick={() => onHeaderClick?.(i)}>
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
                  next[i] = { ...next[i], width: Math.max(60, startWidth + dx) };
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
}: {
  index: number;
  top: number;
  height: number;
  columns: ColumnDef[];
  row?: string[];
  selectedCells: Set<string>;
  onCellClick: (rowIndex: number, colIndex: number, e?: ReactMouseEvent<HTMLDivElement>) => void;
  onCellContextMenu: (rowIndex: number, colIndex: number, e: ReactMouseEvent<HTMLDivElement>) => void;
  onCellDoubleClick: (rowIndex: number, colIndex: number) => void;
  editing: { row: number; col: number; value: string } | null;
  setEditing: (v: { row: number; col: number; value: string } | null) => void;
  editorRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="absolute left-0 right-0 grid border-b select-none" style={{ transform: `translateY(${top}px)`, height, gridTemplateColumns: columns.map(c => `${c.width ?? 160}px`).join(" ") }}>
      {columns.map((c, i) => {
        const isSelected = selectedCells.has(`${index}:${i}`);
        const isEditing = !!(editing && editing.row === index && editing.col === i);
        return (
          <div
            key={i}
            className={`px-2 py-1 text-sm truncate border-r last:border-r-0 cursor-pointer transition-colors select-none ${
              isSelected ? "bg-primary/20 ring-2 ring-primary ring-inset" : "hover:bg-muted/50"
            }`}
            draggable={false}
            onClick={(e) => onCellClick(index, i, e)}
            onContextMenu={(e) => onCellContextMenu(index, i, e)}
            onDoubleClick={() => onCellDoubleClick(index, i)}
          >
            {!isEditing && (row?.[i] ?? "")}
            {isEditing && (
              <Input
                ref={editorRef}
                defaultValue={editing.value}
                onBlur={(e) => {
                  // Commit on blur
                  const nextVal = e.currentTarget.value;
                  // Save value but actual update is handled in parent when Enter/Tab; commit on blur too
                  setEditing({ row: index, col: i, value: nextVal });
                }}
                onChange={(e) => setEditing({ row: index, col: i, value: e.target.value })}
                className="h-6 text-xs px-1 py-0 absolute inset-0 m-0"
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
