import { useEffect, useMemo, useRef, useState } from "react";
import { DataGrid } from "@/components/sheet/DataGrid";
import { useCSVLoader } from "@/hooks/useCSVLoader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Sheet({ initialUrl }: { initialUrl?: string }) {
  const { columns, rows, loadSource, updateCell, applyPaste, clearCells } = useCSVLoader();
  const [colsState, setColsState] = useState(columns);

  // Persist and sync columns width
  useEffect(() => {
    const key = "sheet.columns.widths";
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const widths = JSON.parse(saved) as Record<string, number>;
        setColsState(prev => columns.map((c) => ({ ...c, width: widths[c.name] ?? c.width })));
        return;
      } catch {}
    }
    setColsState(columns);
  }, [columns]);

  const handleColumnsResize = (next: typeof columns) => {
    setColsState(next);
    const map: Record<string, number> = {};
    for (const c of next) if (c.width) map[c.name] = c.width;
    localStorage.setItem("sheet.columns.widths", JSON.stringify(map));
  };
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // Auto-load from ?url if provided; else load sample
  useEffect(() => {
    if (initialUrl) {
      loadSource({ url: initialUrl });
    } else {
      loadSource({ url: "/data/sample.csv" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const [sort, setSort] = useState<{ colIndex: number; dir: 'asc' | 'desc' } | null>(null);

  const stats = useMemo(() => {
    const count = selection.size;
    let rowsCount = 0;
    let colsCount = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;
    let numericCount = 0;
    if (count > 0) {
      const rowsSet = new Set<number>();
      const colsSet = new Set<number>();
      for (const key of selection) {
        const [r, c] = key.split(":").map(n => parseInt(n, 10));
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
      rowsCount = rowsSet.size;
      colsCount = colsSet.size;
    }
    const avg = numericCount > 0 ? sum / numericCount : null;
    return { count, rowsCount, colsCount, sum: numericCount > 0 ? sum : null, avg, min, max };
  }, [selection, rows]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState<string>(initialUrl ?? "");
  const [filters, setFilters] = useState<Record<number, string>>({});

  const openFilePicker = () => fileInputRef.current?.click();
  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadSource({ file });
      // Reset so selecting the same file again triggers change
      e.currentTarget.value = "";
    }
  };

  const loadFromUrl = async () => {
    if (!urlInput) return;
    await loadSource({ url: urlInput });
  };

  const viewIndices = useMemo(() => {
    let idx = Array.from({ length: rows.length }, (_, i) => i);
    const filterEntries = Object.entries(filters).filter(([, v]) => v && v.length > 0) as [string, string][];
    if (filterEntries.length > 0) {
      const norms = filterEntries.map(([k, v]) => [Number(k), v.toLowerCase()] as [number, string]);
      idx = idx.filter(i => {
        const r = rows[i];
        for (const [col, q] of norms) {
          const cell = (r?.[col] ?? "").toLowerCase();
          if (!cell.includes(q)) return false;
        }
        return true;
      });
    }
    if (!sort) return idx;
    const { colIndex, dir } = sort;
    const isNumeric = idx.slice(0, 50).every(i => rows[i]?.[colIndex] === undefined || rows[i]?.[colIndex] === "" || !isNaN(Number(rows[i]?.[colIndex])));
    const cmp = (a: number, b: number) => {
      const va = rows[a]?.[colIndex] ?? "";
      const vb = rows[b]?.[colIndex] ?? "";
      if (isNumeric) {
        const na = Number(va);
        const nb = Number(vb);
        return (na - nb) * (dir === 'asc' ? 1 : -1);
      }
      return va.localeCompare(vb) * (dir === 'asc' ? 1 : -1);
    };
    return idx.sort(cmp);
  }, [rows, sort]);

  const viewRows = useMemo(() => viewIndices.map(i => rows[i]), [rows, viewIndices]);

  const toggleSort = (colIndex: number) => {
    setSort(prev => {
      if (!prev || prev.colIndex !== colIndex) return { colIndex, dir: 'asc' };
      if (prev.dir === 'asc') return { colIndex, dir: 'desc' };
      return null;
    });
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-3 py-2 flex items-center justify-between">
        <div className="text-sm font-medium">Sheet</div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} className="hidden" type="file" accept=".csv,text/csv" onChange={onFilePicked} />
          <Button variant="secondary" size="sm" onClick={openFilePicker}>
            Open CSV
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor="csv-url" className="sr-only">CSV URL</Label>
            <Input id="csv-url" placeholder="https://.../file.csv" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-72" />
            <Button size="sm" onClick={loadFromUrl}>Load</Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadSource({ url: "/data/sample.csv" })}>Sample</Button>
          <ThemeToggle />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {colsState.length > 0 && (
          <div className="sticky top-[33px] z-10 bg-background/90 backdrop-blur border-b px-1 py-1 grid" style={{ gridTemplateColumns: colsState.map(c => `${c.width ?? 160}px`).join(" ") }}>
            {colsState.map((c, i) => (
              <Input key={i} placeholder={`Filter ${c.name}`} value={filters[i] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [i]: e.target.value }))} className="h-7 text-xs" />
            ))}
          </div>
        )}
        <DataGrid
          columns={colsState}
          rows={viewRows}
          rowHeight={32}
          onSelectionChange={setSelection}
          onColumnsResize={handleColumnsResize}
          onHeaderClick={toggleSort}
          onEditCell={(r, c, v) => updateCell(viewIndices[r], c, v)}
          onPaste={(r, c, vals) => {
            const absStart = viewIndices[r];
            applyPaste(absStart, c, vals);
          }}
          onClear={(cells) => {
            const mapped = cells.map(({ row, col }) => ({ row: viewIndices[row], col }));
            clearCells(mapped);
          }}
          onFocusFilter={() => {
            const el = document.getElementById('csv-url');
            if (el instanceof HTMLElement) el.focus();
          }}
        />
      </div>
      <div className="border-t bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-3 py-1 text-xs text-muted-foreground flex items-center gap-4">
        <div>Rows: {rows.length}</div>
        <div>Cols: {columns.length}</div>
        <div>Selected: {stats.count}</div>
        {stats.count > 0 && (
          <div>
            ({stats.rowsCount} rows × {stats.colsCount} cols)
          </div>
        )}
        {stats.sum != null && (
          <div className="flex items-center gap-3">
            <span>Sum: {stats.sum}</span>
            {stats.avg != null && <span>Avg: {Number.isFinite(stats.avg) ? stats.avg.toFixed(4) : String(stats.avg)}</span>}
            {stats.min != null && <span>Min: {stats.min}</span>}
            {stats.max != null && <span>Max: {stats.max}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
