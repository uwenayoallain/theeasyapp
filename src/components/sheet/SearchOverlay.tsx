import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchOverlayProps {
  open: boolean;
  query: string;
  totalMatches: number;
  activeIndex: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function SearchOverlay({
  open,
  query,
  totalMatches,
  activeIndex,
  onChange,
  onClose,
  onNext,
  onPrev,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search within grid"
      className={cn(
        "fixed top-4 right-4 z-50 w-[320px] rounded-md border bg-background shadow-lg ring-1 ring-primary/20",
        "flex flex-col gap-2 p-3 text-sm",
      )}
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor="grid-search-input"
          className="text-xs font-medium text-muted-foreground"
        >
          Find
        </label>
        <Input
          id="grid-search-input"
          ref={inputRef}
          placeholder="Search text…"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onPrev();
              else onNext();
            }
          }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {totalMatches === 0
            ? "No matches"
            : `${activeIndex + 1} of ${totalMatches}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onPrev}
            disabled={totalMatches === 0}
            aria-label="Previous match"
          >
            Prev
          </Button>
          <Button
            size="sm"
            onClick={onNext}
            disabled={totalMatches === 0}
            aria-label="Next match"
          >
            Next
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close search overlay"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
