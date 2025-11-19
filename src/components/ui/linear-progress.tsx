import { cn } from "@/lib/utils";

export function LinearProgress({
  value,
  className,
}: {
  value?: number | null;
  className?: string;
}) {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const clamped = isNumber ? Math.max(0, Math.min(100, value ?? 0)) : null;

  return (
    <div
      className={cn(
        "relative block h-1 w-full overflow-hidden rounded-full bg-border/30",
        className,
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full bg-primary/80 transition-all duration-300 ease-out rounded-full",
          clamped == null ? "linear-progress-indeterminate w-1/3" : "",
        )}
        style={clamped == null ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
