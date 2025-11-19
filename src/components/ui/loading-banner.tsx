import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinearProgress } from "./linear-progress";
import { Button } from "./button";

interface LoadingBannerProps {
  title?: string;
  description?: string | null;
  progress?: number | null;
  onCancel?: () => void;
  cancelLabel?: string;
  className?: string;
}

export function LoadingBanner({
  title = "Loading data",
  description,
  progress = null,
  onCancel,
  cancelLabel = "Cancel",
  className,
}: LoadingBannerProps) {
  return (
    <div
      className={cn(
        "border-b border-border/60 bg-background/95 px-4 py-3 sm:px-6",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{title}</span>
          </div>
          {description && (
            <span className="text-xs text-muted-foreground sm:text-sm">
              {description}
            </span>
          )}
          <div className="flex-1 min-w-[60px]" />
          {onCancel && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={onCancel}
              className="text-xs"
            >
              {cancelLabel}
            </Button>
          )}
        </div>
        <LinearProgress value={progress} />
      </div>
    </div>
  );
}
