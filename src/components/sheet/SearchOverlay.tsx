import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

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
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        document.body.style.overflow = "unset";
        cancelAnimationFrame(id);
      };
    } else {
      document.body.style.overflow = "unset";
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
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Search Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search within grid"
        className={cn(
          "fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-md mx-4",
          "rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          "sm:mx-0",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Search</span>
          <div className="ml-auto">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Search Input */}
        <div className="p-4 pb-3">
          <div className="relative">
            <Input
              id="grid-search-input"
              ref={inputRef}
              placeholder="Search in data..."
              value={query}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) onPrev();
                  else onNext();
                }
              }}
              className="pr-20 bg-muted/30 border-border/50 focus:border-primary/50 focus:ring-primary/20"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onPrev}
                disabled={totalMatches === 0}
                className="h-6 w-6 hover:bg-muted/60"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onNext}
                disabled={totalMatches === 0}
                className="h-6 w-6 hover:bg-muted/60"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/20">
          <span className="text-xs text-muted-foreground font-medium">
            {totalMatches === 0
              ? "No results"
              : `${activeIndex + 1} of ${totalMatches} results`}
          </span>
          <div className="text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
              ↑↓
            </kbd>
            <span className="ml-1">to navigate</span>
          </div>
        </div>
      </div>
    </>
  );
}
