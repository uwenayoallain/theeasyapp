import { useEffect } from "react";

interface UseSheetKeyboardShortcutsOptions {
  searchQuery: string;
  onSearchOpen: () => void;
  onGoToNext: () => void;
  onGoToPrevious: () => void;
  onToggleFilters?: () => void;
  onToggleHelp: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function useSheetKeyboardShortcuts({
  searchQuery,
  onSearchOpen,
  onGoToNext,
  onGoToPrevious,
  onToggleFilters,
  onToggleHelp,
  onUndo,
  onRedo,
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

      if (mod && key === "f" && !event.shiftKey && !isTyping) {
        event.preventDefault();
        onSearchOpen();
        return;
      }

      if (mod && key === "g" && !isTyping) {
        event.preventDefault();
        if (searchQuery.trim()) {
          if (event.shiftKey) onGoToPrevious();
          else onGoToNext();
        } else {
          onSearchOpen();
        }
        return;
      }

      // Global undo/redo when grid may not have focus
      if (mod && !isTyping) {
        if (key === "z" && !event.shiftKey && onUndo) {
          event.preventDefault();
          onUndo();
          return;
        }
        if (
          (key === "z" && event.shiftKey && onRedo) ||
          (key === "y" && onRedo)
        ) {
          event.preventDefault();
          onRedo?.();
          return;
        }
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

      if (
        onToggleFilters &&
        mod &&
        event.shiftKey &&
        key === "f" &&
        !isTyping
      ) {
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
    onUndo,
    onRedo,
  ]);
}
