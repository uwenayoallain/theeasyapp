import { useState, useEffect, useCallback } from "react";
import { logger } from "@/lib/logger";

type SortState = { colIndex: number; dir: "asc" | "desc" } | null;

interface UseSheetSortOptions {
  initialSortParam?: string;
  onSearchChange?: (params: { sort?: string | null }) => void;
}

export function useSheetSort({
  initialSortParam,
  onSearchChange,
}: UseSheetSortOptions = {}) {
  const readInitialSort = (): SortState => {
    try {
      if (typeof initialSortParam === "string") {
        const [c, d] = initialSortParam.split(":");
        const col = Number(c);
        if (Number.isFinite(col) && (d === "asc" || d === "desc")) {
          return { colIndex: col, dir: d as "asc" | "desc" };
        }
      }
      const saved = localStorage.getItem("sheet.sort");
      if (saved) {
        const v = JSON.parse(saved) as SortState;
        if (
          v &&
          Number.isFinite(v.colIndex) &&
          (v.dir === "asc" || v.dir === "desc")
        ) {
          return v;
        }
      }
    } catch (err) {
      logger.warn("Failed to read initial sort:", err);
    }
    return null;
  };

  const [sort, setSort] = useState<SortState>(() => readInitialSort());

  useEffect(() => {
    try {
      if (sort) localStorage.setItem("sheet.sort", JSON.stringify(sort));
      else localStorage.removeItem("sheet.sort");
      const sortParam = sort ? `${sort.colIndex}:${sort.dir}` : null;
      if (onSearchChange) onSearchChange({ sort: sortParam });
      else if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (sortParam) url.searchParams.set("sort", sortParam);
        else url.searchParams.delete("sort");
        window.history.replaceState(null, "", url.toString());
      }
    } catch (err) {
      logger.warn("Failed to persist sort:", err);
    }
  }, [sort, onSearchChange]);

  const toggleSort = useCallback((colIndex: number) => {
    setSort((prev) => {
      if (!prev || prev.colIndex !== colIndex) return { colIndex, dir: "asc" };
      if (prev.dir === "asc") return { colIndex, dir: "desc" };
      return null;
    });
  }, []);

  return { sort, toggleSort };
}
