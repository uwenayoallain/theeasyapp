import { useState, useEffect, useMemo, useCallback } from "react";

interface UseSheetSearchOptions {
  viewRows: string[][];
  initialQueryParam?: string;
  onSearchChange?: (params: { q?: string | null }) => void;
}

export function useSheetSearch({
  viewRows,
  initialQueryParam,
  onSearchChange,
}: UseSheetSearchOptions) {
  const readInitialQuery = (): string => {
    try {
      if (typeof initialQueryParam === "string") return initialQueryParam;
      const saved = localStorage.getItem("sheet.search");
      if (saved) return JSON.parse(saved) as string;
    } catch (err) {
      console.warn("Failed to read search query:", err);
    }
    return "";
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readInitialQuery(),
  );
  const [rawActiveMatchIndex, setActiveMatchIndex] = useState(0);

  const searchMatches = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return [];
    const needle = trimmed.toLowerCase();
    const results: Array<{ viewRowIndex: number; colIndex: number }> = [];
    for (let viewRowIndex = 0; viewRowIndex < viewRows.length; viewRowIndex++) {
      const row = viewRows[viewRowIndex];
      if (!row) continue;
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const cell = row[colIndex];
        if (cell && cell.toLowerCase().includes(needle)) {
          results.push({ viewRowIndex, colIndex });
        }
      }
    }
    return results;
  }, [searchQuery, viewRows]);

  const activeMatchIndex =
    searchMatches.length === 0
      ? 0
      : rawActiveMatchIndex >= searchMatches.length
        ? 0
        : rawActiveMatchIndex;

  useEffect(() => {
    try {
      localStorage.setItem("sheet.search", JSON.stringify(searchQuery));
      const q = searchQuery.trim();
      if (onSearchChange) onSearchChange({ q: q || null });
      else if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (q) url.searchParams.set("q", q);
        else url.searchParams.delete("q");
        window.history.replaceState(null, "", url.toString());
      }
    } catch (err) {
      console.warn("Failed to persist search query:", err);
    }
  }, [searchQuery, onSearchChange]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveMatchIndex((prev) => (prev + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveMatchIndex(
      (prev) => (prev - 1 + searchMatches.length) % searchMatches.length,
    );
  }, [searchMatches.length]);

  const currentMatch =
    searchMatches.length > 0
      ? searchMatches[Math.min(activeMatchIndex, searchMatches.length - 1)]
      : null;

  const currentSearchKey = currentMatch
    ? `${currentMatch.viewRowIndex}:${currentMatch.colIndex}`
    : null;

  const focusCellRequest = currentMatch
    ? {
        row: currentMatch.viewRowIndex,
        col: currentMatch.colIndex,
        id: `${currentMatch.viewRowIndex}:${currentMatch.colIndex}:${activeMatchIndex}:${searchMatches.length}:${searchQuery}`,
      }
    : null;

  return {
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
  };
}
