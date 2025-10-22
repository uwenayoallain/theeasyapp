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
        "relative block h-[3px] w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full bg-primary transition-all duration-200",
          clamped == null ? "linear-progress-indeterminate w-1/3" : "",
        )}
        style={clamped == null ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
