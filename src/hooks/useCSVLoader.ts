import { useState, useCallback, useRef } from "react";
import type { ColumnDef } from "@/lib/csv";
import { fetchAndParseCSV, parseCSVFile } from "@/lib/csvParser";
// Worker is loaded lazily when streaming is used
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Bun bundler supports new URL for workers
const workerFactory = () => new Worker(new URL("../workers/csvWorker.ts", import.meta.url), { type: "module" });

export interface CSVLoaderState {
  columns: ColumnDef[];
  rows: string[][];
  progress: { loaded: number; total?: number };
  isLoading: boolean;
  error: string | null;
}

export function useCSVLoader() {
  const [state, setState] = useState<CSVLoaderState>({
    columns: [],
    rows: [],
    progress: { loaded: 0 },
    isLoading: false,
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);

  const loadSource = useCallback(async (source: { url?: string; file?: File }) => {
    // Reset state
    setState({
      columns: [],
      rows: [],
      progress: { loaded: 0 },
      isLoading: true,
      error: null,
    });

    // Cleanup previous worker if any
    if (workerRef.current) {
      try { workerRef.current.terminate(); } catch {}
      workerRef.current = null;
    }

    try {
      const startTime = performance.now();
      const canStream = typeof Worker !== "undefined" && (source.url || source.file);

      if (canStream) {
        const w = workerFactory();
        workerRef.current = w;
        let rowsBuffer: string[][] = [];
        w.onmessage = (ev: MessageEvent) => {
          const data = ev.data as any;
          if (data.type === "columns") {
            setState(prev => ({ ...prev, columns: data.columns }));
          } else if (data.type === "rows") {
            // accumulate rows and batch state updates
            rowsBuffer.push(...data.rows);
            // throttle re-render
            requestAnimationFrame(() => {
              setState(prev => ({ ...prev, rows: prev.rows.length === 0 ? rowsBuffer.slice() : prev.rows.concat(rowsBuffer.splice(0)) }));
            });
          } else if (data.type === "progress") {
            setState(prev => ({ ...prev, progress: { loaded: data.loaded, total: data.total } }));
          } else if (data.type === "done") {
            const endTime = performance.now();
            console.log(`CSV streamed in ${(endTime - startTime).toFixed(2)}ms`);
            setState(prev => ({ ...prev, isLoading: false }));
            w.terminate();
            workerRef.current = null;
          } else if (data.type === "error") {
            setState(prev => ({ ...prev, error: data.message, isLoading: false }));
            w.terminate();
            workerRef.current = null;
          }
        };
        w.postMessage({ url: source.url, file: source.file, batchSize: 2000 });
        return;
      }

      // Fallback to existing non-streaming parser
      let result;
      if (source.file) {
        result = await parseCSVFile(source.file);
        setState(prev => ({ ...prev, progress: { loaded: source.file!.size } }));
      } else if (source.url) {
        result = await fetchAndParseCSV(source.url);
      } else {
        throw new Error("No source provided");
      }
      const endTime = performance.now();
      console.log(`CSV parsed in ${(endTime - startTime).toFixed(2)}ms`);
      setState({ columns: result.columns, rows: result.rows, progress: { loaded: result.rows.length }, isLoading: false, error: null });
    } catch (error) {
      console.error("CSV loading error:", error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to load CSV",
        isLoading: false,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      columns: [],
      rows: [],
      progress: { loaded: 0 },
      isLoading: false,
      error: null,
    });
    if (workerRef.current) {
      try { workerRef.current.terminate(); } catch {}
      workerRef.current = null;
    }
  }, []);

  return {
    ...state,
    loadSource,
    reset,
    updateCell: (rowIndex: number, colIndex: number, value: string) => {
      setState(prev => {
        const nextRows = prev.rows.slice();
        const r = nextRows[rowIndex] ? nextRows[rowIndex].slice() : [];
        // Ensure width
        if (colIndex >= r.length) r.length = colIndex + 1;
        r[colIndex] = value;
        nextRows[rowIndex] = r;
        return { ...prev, rows: nextRows };
      });
    },
    applyPaste: (startRow: number, startCol: number, values: string[][]) => {
      setState(prev => {
        const nextRows = prev.rows.slice();
        for (let rOff = 0; rOff < values.length; rOff++) {
          const rIndex = startRow + rOff;
          const src = values[rOff];
          const row = nextRows[rIndex] ? nextRows[rIndex].slice() : [];
          for (let cOff = 0; cOff < src.length; cOff++) {
            const cIndex = startCol + cOff;
            if (cIndex >= row.length) row.length = cIndex + 1;
            row[cIndex] = src[cOff];
          }
          nextRows[rIndex] = row;
        }
        return { ...prev, rows: nextRows };
      });
    },
    clearCells: (cells: Array<{ row: number; col: number }>) => {
      setState(prev => {
        if (cells.length === 0) return prev;
        const nextRows = prev.rows.slice();
        const touched = new Map<number, number[]>();
        for (const { row, col } of cells) {
          if (!touched.has(row)) touched.set(row, []);
          touched.get(row)!.push(col);
        }
        for (const [rIndex, cols] of touched) {
          const row = nextRows[rIndex] ? nextRows[rIndex].slice() : [];
          for (const col of cols) {
            if (col < row.length) row[col] = "";
          }
          nextRows[rIndex] = row;
        }
        return { ...prev, rows: nextRows };
      });
    },
  };
}
