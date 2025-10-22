import { useEffect } from "react";

interface UseSheetKeyboardShortcutsOptions {
  searchQuery: string;
  onSearchOpen: () => void;
  onGoToNext: () => void;
  onGoToPrevious: () => void;
  onToggleFilters: () => void;
  onToggleHelp: () => void;
}

export function useSheetKeyboardShortcuts({
  searchQuery,
  onSearchOpen,
  onGoToNext,
  onGoToPrevious,
  onToggleFilters,
  onToggleHelp,
}: UseSheetKeyboardShortcutsOptions) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleGlobalKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable);
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "f") {
        event.preventDefault();
        onSearchOpen();
        return;
      }

      if (mod && key === "g") {
        event.preventDefault();
        if (searchQuery.trim()) {
          if (event.shiftKey) onGoToPrevious();
          else onGoToNext();
        } else {
          onSearchOpen();
        }
        return;
      }

      if (!mod && key === "/" && !isTyping) {
        event.preventDefault();
        onSearchOpen();
        return;
      }

      if (
        !mod &&
        (event.key === "?" || (key === "/" && event.shiftKey)) &&
        !isTyping
      ) {
        event.preventDefault();
        onToggleHelp();
        return;
      }

      if (mod && event.shiftKey && key === "f") {
        event.preventDefault();
        onToggleFilters();
        return;
      }
    };

    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [
    searchQuery,
    onSearchOpen,
    onGoToNext,
    onGoToPrevious,
    onToggleFilters,
    onToggleHelp,
  ]);
}
