import { memo } from "react";
import { cn } from "@/lib/utils";

interface SkeletonGridProps {
  columns?: number;
  rows?: number;
  className?: string;
}

const SkeletonCell = memo(function SkeletonCell({
  isHeader = false,
  width = 160,
  isNumeric = false,
}: {
  isHeader?: boolean;
  width?: number;
  isNumeric?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3 flex items-center",
        isHeader ? "bg-muted/30" : "",
      )}
      style={{ width }}
    >
      <div
        className={cn(
          "bg-muted-foreground/10 rounded-md animate-pulse",
          isHeader ? "h-4 w-24" : isNumeric ? "h-3 w-16 ml-auto" : "h-3 w-32",
        )}
      />
    </div>
  );
});

export const SkeletonGrid = memo(function SkeletonGrid({
  columns = 5,
  rows = 20,
  className,
}: SkeletonGridProps) {
  const columnWidths = Array.from({ length: columns }, (_, i) =>
    i === 0 ? 200 : i % 3 === 0 ? 120 : 160,
  );

  return (
    <div className={cn("relative bg-background", className)}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 bg-muted/30 backdrop-blur-sm border-b border-border/50 grid select-none"
        style={{
          gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(" "),
        }}
      >
        {columnWidths.map((width, i) => (
          <SkeletonCell key={i} isHeader width={width} />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }, (_, rowIndex) => {
        const isEvenRow = rowIndex % 2 === 0;
        return (
          <div
            key={rowIndex}
            className={cn(
              "grid transition-colors duration-150",
              isEvenRow ? "bg-background" : "bg-muted/20",
            )}
            style={{
              gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(" "),
            }}
          >
            {columnWidths.map((width, colIndex) => (
              <SkeletonCell
                key={colIndex}
                width={width}
                isNumeric={colIndex > 0 && colIndex % 2 === 0}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
});
