import { useState, useEffect } from "react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { logger } from "@/lib/logger";

interface UseSheetFiltersOptions {
  initialFiltersParam?: string;
  onSearchChange?: (params: { filters?: string | null }) => void;
}

export function useSheetFilters({
  initialFiltersParam,
  onSearchChange,
}: UseSheetFiltersOptions = {}) {
  const readInitialFilters = (): Record<number, string> => {
    try {
      if (
        typeof initialFiltersParam === "string" &&
        initialFiltersParam.length > 0
      ) {
        const parsed = JSON.parse(initialFiltersParam) as Record<
          string,
          string
        >;
        const out: Record<number, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const col = Number(k);
          if (Number.isFinite(col) && typeof v === "string") out[col] = v;
        }
        return out;
      }
      const saved = localStorage.getItem("sheet.filters");
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string | number, string>;
        const out: Record<number, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const col = Number(k);
          if (Number.isFinite(col) && typeof v === "string") out[col] = v;
        }
        return out;
      }
    } catch (err) {
      logger.warn("Failed to restore filters:", err);
    }
    return {};
  };

  const initialFiltersSnapshot = readInitialFilters();

  const [filters, setFilters] = useState<Record<number, string>>(
    () => initialFiltersSnapshot,
  );
  const debouncedFilters = useDebouncedValue(filters, 200);

  const [showFilters, setShowFilters] = useState<boolean>(() => {
    if (Object.keys(initialFiltersSnapshot).length > 0) return true;
    try {
      return localStorage.getItem("sheet.filters.visible") === "1";
    } catch (err) {
      logger.warn("Failed to read filters visibility:", err);
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sheet.filters.visible", showFilters ? "1" : "0");
    } catch (err) {
      logger.warn("Failed to save filters visibility:", err);
    }
  }, [showFilters]);

  useEffect(() => {
    try {
      const compact: Record<number, string> = {};
      for (const [k, v] of Object.entries(debouncedFilters)) {
        if (typeof v === "string" && v.trim().length > 0) {
          compact[Number(k)] = v;
        }
      }
      localStorage.setItem("sheet.filters", JSON.stringify(compact));
      const filtersParam =
        Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
      if (onSearchChange) onSearchChange({ filters: filtersParam });
      else if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (filtersParam)
          url.searchParams.set("filters", encodeURIComponent(filtersParam));
        else url.searchParams.delete("filters");
        window.history.replaceState(null, "", url.toString());
      }
    } catch (err) {
      logger.warn("Failed to persist filters:", err);
    }
  }, [debouncedFilters, onSearchChange]);

  return {
    filters,
    setFilters,
    debouncedFilters,
    showFilters,
    setShowFilters,
  };
}
