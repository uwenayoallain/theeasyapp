import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    const id = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-2xl p-5 bg-background/95 backdrop-blur border shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
          <Button
            ref={closeRef}
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close shortcuts help"
          >
            Close
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Search & Navigation
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Shortcut name="Find" kbd={<Kbd keys={[modKey, "F"]} />} />
              <Shortcut name="Find (alternate)" kbd={<Kbd>/</Kbd>} />
              <Shortcut name="Next match" kbd={<Kbd>Enter</Kbd>} />
              <Shortcut
                name="Prev match"
                kbd={<Kbd keys={["Shift", "Enter"]} />}
              />
              <Shortcut
                name="Toggle filters"
                kbd={<Kbd keys={[modKey, "Shift", "F"]} />}
              />
              <Shortcut name="Move cell" kbd={<Kbd>↑ ↓ ← →</Kbd>} />
              <Shortcut
                name="Jump to edge"
                kbd={<Kbd keys={[modKey, "Arrow"]} />}
              />
              <Shortcut name="Go to start/end" kbd={<Kbd>Home</Kbd>} />
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Editing
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Shortcut name="Edit cell" kbd={<Kbd>Enter</Kbd>} />
              <Shortcut name="Edit cell (alt)" kbd={<Kbd>F2</Kbd>} />
              <Shortcut name="Commit & move" kbd={<Kbd>Tab</Kbd>} />
              <Shortcut name="Copy" kbd={<Kbd keys={[modKey, "C"]} />} />
              <Shortcut name="Paste" kbd={<Kbd keys={[modKey, "V"]} />} />
              <Shortcut name="Cut" kbd={<Kbd keys={[modKey, "X"]} />} />
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Selection
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Shortcut
                name="Extend selection"
                kbd={<Kbd keys={["Shift", "Arrow"]} />}
              />
              <Shortcut name="Clear selection" kbd={<Kbd>Esc</Kbd>} />
              <Shortcut
                name="Select row"
                kbd={<Kbd keys={["Shift", "Space"]} />}
              />
              <Shortcut
                name="Select column"
                kbd={<Kbd keys={[modKey, "Space"]} />}
              />
              <Shortcut
                name="Select all visible"
                kbd={<Kbd keys={[modKey, "A"]} />}
              />
              <Shortcut name="Show shortcuts" kbd={<Kbd>?</Kbd>} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Shortcut({ name, kbd }: { name: string; kbd: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{name}</span>
      <div className="flex items-center gap-1">{kbd}</div>
    </div>
  );
}
