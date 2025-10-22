import type { ReactNode, MouseEvent } from "react";
import { cn } from "@/lib/utils";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  children,
  className,
}: ContextMenuProps) {
  if (!open) return null;

  const handleBackdropClick = () => onClose();
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={handleBackdropClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        role="menu"
        className={cn(
          "min-w-40 max-w-64 rounded-md border bg-popover text-popover-foreground shadow-md p-1",
          "select-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        style={{ position: "fixed", left: x, top: y }}
        onClick={stop}
        data-state="open"
      >
        {children}
      </div>
    </div>
  );
}

export function ContextMenuItem({
  onSelect,
  children,
  disabled,
  className,
}: {
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onSelect();
  };
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        disabled
          ? "opacity-50"
          : "hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export function ContextMenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}
