import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DataGrid } from "@/components/sheet/DataGrid";
import { SearchOverlay } from "@/components/sheet/SearchOverlay";
import { ShortcutsHelp } from "@/components/sheet/ShortcutsHelp";
import { useCSVLoader, type CSVLoaderState } from "@/hooks/useCSVLoader";
import { useSheetSort } from "@/hooks/useSheetSort";
import { useSheetSearch } from "@/hooks/useSheetSearch";
import { useSheetKeyboardShortcuts } from "@/hooks/useSheetKeyboardShortcuts";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PerfHUD } from "@/components/PerfHUD";
import {
  Search,
  HelpCircle,
  Download,
  FileText,
  Undo2,
  Redo2,
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
import { useToast } from "@/components/ui/toast-provider";
import { logger } from "@/lib/logger";
import { LoadingBanner } from "@/components/ui/loading-banner";
// Filters are disabled for now

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
  initialQueryParam,
  onSearchChange,
  autoLoadDefault = false,
}: {
  initialUrl?: string;
  initialSortParam?: string;
  initialQueryParam?: string;
  onSearchChange?: (next: { sort?: string | null; q?: string | null }) => void;
  autoLoadDefault?: boolean;
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
    undo,
    redo,
    canUndo,
    canRedo,
    isSaving,
    savingCount,
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
          if (process.env.NODE_ENV !== "production") {
            logger.warn("Sheet: failed to decode initial DuckDB URL", error);
          }
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
        if (process.env.NODE_ENV !== "production") {
          logger.warn("Sheet: failed to restore column widths", error);
        }
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
  const debouncedWidthOverrides = useDebouncedValue(widthOverrides, 300);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "sheet.columns.widths",
        JSON.stringify(debouncedWidthOverrides),
      );
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        logger.warn("Sheet: failed to persist column widths", error);
      }
    }
  }, [debouncedWidthOverrides]);

  const handleColumnsResize = useCallback((next: typeof columns) => {
    const overrides: Record<string, number> = {};
    for (const c of next) {
      if (typeof c.width === "number") overrides[c.name] = c.width;
    }
    setWidthOverrides(overrides);
  }, []);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // Upload UI removed; keep URL loader only
  const [datasetUrl, setDatasetUrl] = useState(initialDatasetUrl);

  const updateUrlParam = (value: string | null) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (value) url.searchParams.set("url", value);
      else url.searchParams.delete("url");
      window.history.replaceState(null, "", url.toString());
    } catch (error) {
      logger.warn("Sheet: failed to update url search param", error);
    }
  };

  // File upload handlers removed

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
        logger.error("Failed to load remote CSV into DuckDB:", err);
      }
    },
    [datasetUrl, loadSource],
  );

  // Sample dataset loader removed

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
        logger.error("Failed to fetch DuckDB chunk:", err);
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
                logger.warn("Sheet: failed to decode duckdb:url spec", error);
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
        if (autoLoadDefault) {
          await loadSource({ type: "duckdb" });
        }
      } catch (error) {
        logger.error("Sheet: initial load failed", error);
      }
    };

    void runInitialLoad();
  }, [initialUrl, loadSource, autoLoadDefault]);

  const { sort, toggleSort } = useSheetSort({
    initialSortParam,
    onSearchChange,
  });
  // Filters disabled
  const prevSortRef = useRef<{ colIndex: number; dir: "asc" | "desc" } | null>(
    null,
  );
  const [filterSortKey, setFilterSortKey] = useState(0);

  useEffect(() => {
    if (!isChunked || !setFiltersAndSort || isLoading) return;
    if (rows.length === 0) {
      prevSortRef.current = sort;
      return;
    }
    const sortChanged =
      JSON.stringify(prevSortRef.current) !== JSON.stringify(sort);
    if (!sortChanged) return;
    prevSortRef.current = sort;
    void setFiltersAndSort({}, sort ?? undefined).then(() => {
      setFilterSortKey((k) => k + 1);
    });
  }, [isChunked, sort, setFiltersAndSort, isLoading, rows.length]);

  const selectionCount = useMemo(() => selection.size, [selection]);

  const cancelRequestedRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const viewIndices = useMemo(() => {
    if (isChunked) return null;
    const idx = Array.from({ length: rows.length }, (_, i) => i);
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
  }, [rows, sort, isChunked]);

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
    onToggleHelp: () => setShortcutsOpen((o) => !o),
    onUndo: undo,
    onRedo: redo,
  });

  const percentLoaded =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;
  const progressSummary = formatProgress(progress) ?? "";
  const showLoadingBanner =
    (isLoading && rows.length === 0) ||
    (!isChunked &&
      rows.length === 0 &&
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
        <div className="border-b border-border/50 bg-background/80 backdrop-blur-md px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-4 sm:gap-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-semibold tracking-tight">
                Data Explorer
              </span>
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
                className="w-40 sm:w-48 md:w-64"
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
            {/* Upload and Load Sample actions removed */}
          </div>

          <div className="flex items-center gap-2">
            {/* Filters UI removed */}

            {/* Saving status */}
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              {isSaving ? (
                <>
                  <span className="inline-flex h-2 w-2 rounded-full border border-primary border-t-transparent animate-spin" />
                  <span>
                    Saving{savingCount > 1 ? ` (${savingCount})` : ""}…
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/80">
                  All changes saved
                </span>
              )}
            </div>

            {/* Undo/Redo */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => undo()}
                  disabled={!canUndo}
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl/Cmd+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => redo()}
                  disabled={!canRedo}
                  aria-label="Redo"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)
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
        <div className="pointer-events-none fixed inset-x-0 top-[72px] z-40 flex justify-center px-3 sm:px-6">
          <LoadingBanner
            title="Loading dataset"
            description={progressSummary || null}
            progress={percentLoaded}
            onCancel={isLoading ? handleCancelLoad : undefined}
            className="pointer-events-auto w-full max-w-2xl rounded-xl border border-border/70 bg-background/95 shadow-lg shadow-black/10 backdrop-blur"
          />
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DataGrid
          key={isChunked ? filterSortKey : undefined}
          columns={colsState}
          rows={viewRows}
          totalRows={rowCount}
          rowHeight={32}
          onRangeChange={isChunked ? handleVisibleRangeChange : undefined}
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
          onSearchShortcut={() => setSearchOpen(true)}
          currentSearchKey={currentSearchKey}
          searchQuery={searchQuery}
          focusCellRequest={focusCellRequest}
          sortState={sort}
          onUndo={undo}
          onRedo={redo}
        />
      </div>
      <div className="border-t border-border/50 bg-background/80 backdrop-blur-md px-4 sm:px-6 py-2 sm:py-3 text-xs flex items-center gap-3 sm:gap-4 overflow-x-auto">
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
              <TooltipContent>Total rows in dataset</TooltipContent>
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

            {selectionCount > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Selected:</span>
                      <Badge variant="secondary" className="font-mono">
                        {selectionCount}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {selectionCount} cells selected
                  </TooltipContent>
                </Tooltip>
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
