import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { DataGrid } from "@/components/sheet/DataGrid";
import { SearchOverlay } from "@/components/sheet/SearchOverlay";
import { ShortcutsHelp } from "@/components/sheet/ShortcutsHelp";
import { useCSVLoader, type CSVLoaderState } from "@/hooks/useCSVLoader";
import { useSheetSort } from "@/hooks/useSheetSort";
import { useSheetFilters } from "@/hooks/useSheetFilters";
import { useSheetSearch } from "@/hooks/useSheetSearch";
import { useSheetKeyboardShortcuts } from "@/hooks/useSheetKeyboardShortcuts";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PerfHUD } from "@/components/PerfHUD";
import {
  Filter,
  Upload,
  Search,
  HelpCircle,
  Download,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LinearProgress } from "@/components/ui/linear-progress";
import { useToast } from "@/components/ui/toast-provider";
import { computeSelectionStats } from "@/lib/selection";
import {
  createFilterPredicate,
  inferNumericColumns,
  type FilterPredicate,
} from "@/lib/filterPredicate";

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatProgress = (progress: CSVLoaderState["progress"]) => {
  const unit = progress.unit ?? "bytes";
  if (unit === "rows") {
    if (progress.total && progress.total > 0) {
      return `${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()} rows`;
    }
    if (progress.loaded > 0) {
      return `${progress.loaded.toLocaleString()} rows`;
    }
    return null;
  }
  if (progress.total && progress.total > 0) {
    return `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`;
  }
  if (progress.loaded > 0) {
    return `${formatBytes(progress.loaded)} loaded`;
  }
  return null;
};

export function Sheet({
  initialUrl,
  initialSortParam,
  initialFiltersParam,
  initialQueryParam,
  onSearchChange,
}: {
  initialUrl?: string;
  initialSortParam?: string;
  initialFiltersParam?: string;
  initialQueryParam?: string;
  onSearchChange?: (next: {
    sort?: string | null;
    filters?: string | null;
    q?: string | null;
  }) => void;
}) {
  const {
    columns,
    rows,
    rowCount,
    isChunked,
    loadedRowIndices,
    loadSource,
    setFiltersAndSort,
    updateCell,
    applyPaste,
    clearCells,
    error,
    isLoading,
    progress,
    cancel,
    ensureRange,
  } = useCSVLoader();
  const { showToast } = useToast();
  const initialDatasetUrl = useMemo(() => {
    if (!initialUrl) return "";
    if (initialUrl.startsWith("duckdb:")) {
      const spec = initialUrl.slice("duckdb:".length);
      if (spec.startsWith("url=")) {
        const encoded = spec.slice(4);
        try {
          return decodeURIComponent(encoded);
        } catch (error) {
          console.warn("Sheet: failed to decode initial DuckDB URL", error);
          return "";
        }
      }
      return "";
    }
    return initialUrl;
  }, [initialUrl]);
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(
    () => {
      if (typeof window === "undefined") return {};
      try {
        const saved = window.localStorage.getItem("sheet.columns.widths");
        if (!saved) return {};
        const parsed = JSON.parse(saved) as Record<string, number>;
        return Object.fromEntries(
          Object.entries(parsed).filter(
            ([, value]) => typeof value === "number" && Number.isFinite(value),
          ),
        );
      } catch (error) {
        console.warn("Sheet: failed to restore column widths", error);
        return {};
      }
    },
  );
  const colsState = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        width: widthOverrides[col.name] ?? col.width,
      })),
    [columns, widthOverrides],
  );
  const persistWidthOverrides = useCallback(
    (overrides: Record<string, number>) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          "sheet.columns.widths",
          JSON.stringify(overrides),
        );
      } catch (error) {
        console.warn("Sheet: failed to persist column widths", error);
      }
    },
    [],
  );
  const handleColumnsResize = useCallback(
    (next: typeof columns) => {
      const overrides: Record<string, number> = {};
      for (const c of next) {
        if (typeof c.width === "number") overrides[c.name] = c.width;
      }
      setWidthOverrides(overrides);
      persistWidthOverrides(overrides);
    },
    [persistWidthOverrides],
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [datasetUrl, setDatasetUrl] = useState(initialDatasetUrl);

  const updateUrlParam = (value: string | null) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (value) url.searchParams.set("url", value);
      else url.searchParams.delete("url");
      window.history.replaceState(null, "", url.toString());
    } catch (error) {
      console.warn("Sheet: failed to update url search param", error);
    }
  };

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!file) return;
      try {
        await loadSource({ type: "duckdb", file });
        setDatasetUrl("");
        updateUrlParam(null);
      } catch (err) {
        console.error("Failed to load CSV file into DuckDB:", err);
      }
    },
    [loadSource],
  );

  const handleLoadUrlSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = datasetUrl.trim();
      if (!trimmed) return;
      try {
        await loadSource({ type: "duckdb", url: trimmed });
        setDatasetUrl(trimmed);
        updateUrlParam(`duckdb:url=${encodeURIComponent(trimmed)}`);
      } catch (err) {
        console.error("Failed to load remote CSV into DuckDB:", err);
      }
    },
    [datasetUrl, loadSource],
  );

  const handleLoadSample = useCallback(async () => {
    try {
      await loadSource({ type: "duckdb" });
      setDatasetUrl("");
      updateUrlParam("duckdb:dataset");
    } catch (err) {
      console.error("Failed to load sample dataset:", err);
    }
  }, [loadSource]);

  const handleVisibleRangeChange = useCallback(
    ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
      if (!isChunked) return;

      const pad = 50;
      const rangeStart = Math.max(0, startIndex - pad);
      const rangeEnd = endIndex + pad;

      const allLoaded = Array.from(
        { length: rangeEnd - rangeStart + 1 },
        (_, i) => rangeStart + i,
      ).every((idx) => loadedRowIndices.includes(idx));

      if (allLoaded) return;

      void ensureRange(rangeStart, rangeEnd).catch((err) => {
        console.error("Failed to fetch DuckDB chunk:", err);
      });
    },
    [ensureRange, loadedRowIndices, isChunked],
  );

  const hasInitialLoadRef = useRef(false);

  useEffect(() => {
    if (hasInitialLoadRef.current) return;
    hasInitialLoadRef.current = true;

    const runInitialLoad = async () => {
      try {
        if (initialUrl) {
          if (initialUrl.startsWith("duckdb:")) {
            const spec = initialUrl.slice("duckdb:".length);
            if (spec.startsWith("url=")) {
              const encoded = spec.slice(4);
              try {
                const remote = decodeURIComponent(encoded);
                if (remote) {
                  await loadSource({ type: "duckdb", url: remote });
                  return;
                }
              } catch (error) {
                console.warn("Sheet: failed to decode duckdb:url spec", error);
              }
            } else if (spec.startsWith("table=")) {
              const tableName = spec.slice(6) || undefined;
              await loadSource({ type: "duckdb", table: tableName });
              return;
            } else {
              const table = spec || undefined;
              await loadSource({ type: "duckdb", table });
              return;
            }
          } else {
            await loadSource({ url: initialUrl });
            return;
          }
        }
        await loadSource({ type: "duckdb" });
      } catch (error) {
        console.error("Sheet: initial load failed", error);
      }
    };

    void runInitialLoad();
  }, [initialUrl, loadSource]);

  const { sort, toggleSort } = useSheetSort({
    initialSortParam,
    onSearchChange,
  });

  const { filters, setFilters, debouncedFilters, showFilters, setShowFilters } =
    useSheetFilters({
      initialFiltersParam,
      onSearchChange,
    });

  const prevFiltersRef = useRef<Record<number, string>>({});
  const prevSortRef = useRef<{ colIndex: number; dir: "asc" | "desc" } | null>(
    null,
  );
  const hasAppliedInitialFiltersRef = useRef(false);
  const [filterSortKey, setFilterSortKey] = useState(0);

  useEffect(() => {
    if (!isChunked || !setFiltersAndSort || isLoading) return;

    if (!hasAppliedInitialFiltersRef.current && rows.length === 0) {
      hasAppliedInitialFiltersRef.current = true;
      prevFiltersRef.current = debouncedFilters;
      prevSortRef.current = sort;
      return;
    }

    const filtersChanged =
      JSON.stringify(prevFiltersRef.current) !==
      JSON.stringify(debouncedFilters);
    const sortChanged =
      JSON.stringify(prevSortRef.current) !== JSON.stringify(sort);

    if (!filtersChanged && !sortChanged) return;

    prevFiltersRef.current = debouncedFilters;
    prevSortRef.current = sort;

    void setFiltersAndSort(
      debouncedFilters,
      sort
        ? {
            colIndex: sort.colIndex,
            dir: sort.dir,
          }
        : undefined,
    ).then(() => {
      setFilterSortKey((k) => k + 1);
    });
  }, [
    isChunked,
    debouncedFilters,
    sort,
    setFiltersAndSort,
    isLoading,
    rows.length,
  ]);

  const stats = useMemo(
    () => computeSelectionStats(selection, rows),
    [selection, rows],
  );
  const statNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }),
    [],
  );
  const formatStatNumber = useCallback(
    (value: number | null): string | null => {
      if (value == null) return null;
      if (!Number.isFinite(value)) return String(value);
      return statNumberFormatter.format(value);
    },
    [statNumberFormatter],
  );
  const numericColumns = useMemo(() => {
    if (colsState.length === 0 || rows.length === 0)
      return colsState.map(() => false);
    return inferNumericColumns(rows, colsState);
  }, [colsState, rows]);
  const filterPredicates = useMemo(() => {
    if (isChunked) return [];
    const entries: Array<{ colIndex: number; predicate: FilterPredicate }> = [];
    for (const [key, raw] of Object.entries(debouncedFilters)) {
      if (typeof raw !== "string" || raw.trim().length === 0) continue;
      const colIndex = Number(key);
      if (
        !Number.isInteger(colIndex) ||
        colIndex < 0 ||
        colIndex >= colsState.length
      )
        continue;
      entries.push({
        colIndex,
        predicate: createFilterPredicate(raw, {
          isNumeric: numericColumns[colIndex] ?? false,
        }),
      });
    }
    return entries;
  }, [debouncedFilters, colsState, numericColumns, isChunked]);

  const cancelRequestedRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const viewIndices = useMemo(() => {
    if (isChunked) return null;
    let idx = Array.from({ length: rows.length }, (_, i) => i);
    if (filterPredicates.length > 0) {
      idx = idx.filter((i) => {
        const row = rows[i];
        for (const { colIndex, predicate } of filterPredicates) {
          const cell = row?.[colIndex];
          if (!predicate(cell ?? "")) return false;
        }
        return true;
      });
    }
    if (!sort) return idx;
    const { colIndex, dir } = sort;
    const isNumeric = idx
      .slice(0, 50)
      .every(
        (i) =>
          rows[i]?.[colIndex] === undefined ||
          rows[i]?.[colIndex] === "" ||
          !isNaN(Number(rows[i]?.[colIndex])),
      );
    const cmp = (a: number, b: number) => {
      const va = rows[a]?.[colIndex] ?? "";
      const vb = rows[b]?.[colIndex] ?? "";
      if (isNumeric) {
        const na = Number(va);
        const nb = Number(vb);
        return (na - nb) * (dir === "asc" ? 1 : -1);
      }
      return va.localeCompare(vb) * (dir === "asc" ? 1 : -1);
    };
    return idx.sort(cmp);
  }, [rows, sort, filterPredicates, isChunked]);

  const viewRows = useMemo(() => {
    if (!viewIndices) return rows;
    return viewIndices.map((i) => rows[i] ?? []);
  }, [rows, viewIndices]);

  const visibleRowCount = viewIndices ? viewIndices.length : rows.length;
  const visibleRowsLabel =
    visibleRowCount === rowCount
      ? visibleRowCount.toLocaleString()
      : `${visibleRowCount.toLocaleString()} of ${rowCount.toLocaleString()}`;

  const mapToAbsoluteRow = useCallback(
    (viewRowIndex: number): number | null => {
      if (!viewIndices) return viewRowIndex;
      return viewIndices[viewRowIndex] ?? null;
    },
    [viewIndices],
  );

  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchMatches,
    activeMatchIndex,
    goToNextMatch,
    goToPreviousMatch,
    currentSearchKey,
    focusCellRequest,
  } = useSheetSearch({
    viewRows,
    initialQueryParam,
    onSearchChange,
  });

  useSheetKeyboardShortcuts({
    searchQuery,
    onSearchOpen: () => setSearchOpen(true),
    onGoToNext: goToNextMatch,
    onGoToPrevious: goToPreviousMatch,
    onToggleFilters: () => setShowFilters((v) => !v),
    onToggleHelp: () => setShortcutsOpen((o) => !o),
  });

  const percentLoaded =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;
  const progressSummary = formatProgress(progress) ?? "";
  const showLoadingBanner =
    isLoading ||
    (!isChunked &&
      typeof progress.total === "number" &&
      progress.total > 0 &&
      progress.loaded < progress.total);

  const handleCancelLoad = () => {
    if (!isLoading) return;
    cancelRequestedRef.current = true;
    cancel();
    showToast({
      title: "Load cancelled",
      description: "Streaming has been stopped.",
    });
  };

  useEffect(() => {
    if (isLoading) {
      cancelRequestedRef.current = false;
    }
  }, [isLoading]);

  useEffect(() => {
    if (!error) return;
    cancelRequestedRef.current = false;
    showToast({
      variant: "error",
      title: "Failed to load dataset",
      description: error,
    });
  }, [error, showToast]);

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      const fullyLoaded = !isChunked || loadedRowIndices.length === rowCount;
      if (
        !error &&
        !cancelRequestedRef.current &&
        rows.length > 0 &&
        fullyLoaded
      ) {
        showToast({
          variant: "success",
          title: "CSV loaded",
          description: `${rows.length.toLocaleString()} rows ready.`,
        });
      }
      cancelRequestedRef.current = false;
    }
    wasLoadingRef.current = isLoading;
  }, [
    isLoading,
    error,
    rows.length,
    showToast,
    isChunked,
    loadedRowIndices.length,
    rowCount,
  ]);

  return (
    <div className="flex flex-col h-screen">
      <TooltipProvider>
        <div className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">Sheet</span>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <form
              onSubmit={handleLoadUrlSubmit}
              className="flex items-center gap-2"
            >
              <Input
                value={datasetUrl}
                onChange={(event) => setDatasetUrl(event.target.value)}
                placeholder="https://example.com/data.csv"
                className="w-48 sm:w-64"
                aria-label="Load CSV from URL"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={isLoading || datasetUrl.trim().length === 0}
              >
                Load URL
              </Button>
            </form>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileInputChange}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={triggerFilePicker}
                  disabled={isLoading}
                >
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Upload</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload CSV file</TooltipContent>
            </Tooltip>

            <Button
              size="sm"
              variant="ghost"
              onClick={handleLoadSample}
              disabled={isLoading}
            >
              Load Sample
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showFilters ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setShowFilters((v) => !v)}
                  aria-pressed={showFilters}
                  aria-label={showFilters ? "Hide filters" : "Show filters"}
                >
                  <Filter className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showFilters ? "Hide filters" : "Show filters"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search (Ctrl+F)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6" />

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={rows.length === 0}
                      aria-label="Export data"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export data</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export as</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>CSV (coming soon)</DropdownMenuItem>
                <DropdownMenuItem disabled>JSON (coming soon)</DropdownMenuItem>
                <DropdownMenuItem disabled>SQL (coming soon)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Separator orientation="vertical" className="h-6" />

            <ThemeToggle />
            <PerfHUD />
          </div>
        </div>
      </TooltipProvider>
      {showLoadingBanner && (
        <div
          className="border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span className="font-medium text-foreground">
              Loading dataset…
            </span>
            {progressSummary && (
              <div className="hidden sm:block text-[11px] text-muted-foreground/80 whitespace-nowrap">
                {progressSummary}
              </div>
            )}
            <div className="flex-1" />
            {isLoading && (
              <Button size="sm" variant="ghost" onClick={handleCancelLoad}>
                Cancel
              </Button>
            )}
          </div>
          <div className="mt-2 -mx-3">
            <LinearProgress value={percentLoaded} />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DataGrid
          key={isChunked ? filterSortKey : undefined}
          columns={colsState}
          rows={viewRows}
          totalRows={rowCount}
          rowHeight={32}
          filtersHeight={34}
          onRangeChange={isChunked ? handleVisibleRangeChange : undefined}
          filtersRow={
            showFilters && colsState.length > 0 ? (
              <>
                {colsState.map((c, i) => (
                  <Input
                    key={i}
                    id={`filter-input-${i}`}
                    placeholder={`Filter ${c.name}`}
                    aria-label={`Filter ${c.name}`}
                    value={filters[i] ?? ""}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, [i]: e.target.value }))
                    }
                    className="h-7 text-xs"
                  />
                ))}
              </>
            ) : null
          }
          onSelectionChange={setSelection}
          onColumnsResize={handleColumnsResize}
          onHeaderClick={toggleSort}
          onEditCell={(r, c, v) => {
            const absoluteRow = mapToAbsoluteRow(r);
            if (absoluteRow == null) return;
            updateCell(absoluteRow, c, v);
          }}
          onPaste={(r, c, vals) => {
            const absoluteRow = mapToAbsoluteRow(r);
            if (absoluteRow == null) return;
            applyPaste(absoluteRow, c, vals);
          }}
          onClear={(cells) => {
            const mapped = cells
              .map(({ row, col }) => {
                const absoluteRow = mapToAbsoluteRow(row);
                if (absoluteRow == null) return null;
                return { row: absoluteRow, col };
              })
              .filter(
                (cell): cell is { row: number; col: number } => cell !== null,
              );
            if (mapped.length > 0) clearCells(mapped);
          }}
          onFocusFilter={() => {
            const firstFilterId = `filter-input-0`;
            if (!showFilters) {
              setShowFilters(true);
              requestAnimationFrame(() => {
                const el = document.getElementById(firstFilterId);
                if (el instanceof HTMLElement) el.focus();
              });
              return;
            }
            const el = document.getElementById(firstFilterId);
            if (el instanceof HTMLElement) el.focus();
          }}
          onSearchShortcut={() => setSearchOpen(true)}
          currentSearchKey={currentSearchKey}
          searchQuery={searchQuery}
          focusCellRequest={focusCellRequest}
          sortState={sort}
        />
      </div>
      <div className="border-t bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-4 py-2 text-xs flex items-center gap-3">
        <TooltipProvider>
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Rows:</span>
                  <Badge variant="outline" className="font-mono">
                    {visibleRowsLabel}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {visibleRowCount === rowCount
                  ? "Total rows in dataset"
                  : "Filtered rows / Total rows"}
              </TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-4" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Cols:</span>
                  <Badge variant="outline" className="font-mono">
                    {columns.length}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>Total columns</TooltipContent>
            </Tooltip>

            {stats.count > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Selected:</span>
                      <Badge variant="secondary" className="font-mono">
                        {stats.count}
                      </Badge>
                      <span className="text-muted-foreground text-[10px]">
                        ({stats.rowsCount} × {stats.colsCount})
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {stats.count} cells selected ({stats.rowsCount} rows ×{" "}
                    {stats.colsCount} columns)
                  </TooltipContent>
                </Tooltip>
              </>
            )}

            {stats.sum != null && (
              <>
                <Separator orientation="vertical" className="h-4" />

                <div className="flex items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Sum:</span>
                        <Badge variant="success" className="font-mono">
                          {formatStatNumber(stats.sum)}
                        </Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Sum of selected numeric cells
                    </TooltipContent>
                  </Tooltip>

                  {stats.avg != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Avg:</span>
                          <Badge variant="success" className="font-mono">
                            {formatStatNumber(stats.avg)}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        Average of selected numeric cells
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {stats.min != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Min:</span>
                          <Badge variant="outline" className="font-mono">
                            {formatStatNumber(stats.min)}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        Minimum value in selection
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {stats.max != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Max:</span>
                          <Badge variant="outline" className="font-mono">
                            {formatStatNumber(stats.max)}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        Maximum value in selection
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </>
            )}
          </div>
        </TooltipProvider>
      </div>
      <SearchOverlay
        open={searchOpen}
        query={searchQuery}
        totalMatches={searchMatches.length}
        activeIndex={
          searchMatches.length === 0
            ? 0
            : Math.min(activeMatchIndex, searchMatches.length - 1)
        }
        onChange={setSearchQuery}
        onClose={() => setSearchOpen(false)}
        onNext={goToNextMatch}
        onPrev={goToPreviousMatch}
      />
      <ShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
