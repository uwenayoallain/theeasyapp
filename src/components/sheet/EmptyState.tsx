import { memo } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Upload, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  type: "loading" | "no-data" | "error";
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  className?: string;
}

export const EmptyState = memo(function EmptyState({
  type,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const getContent = () => {
    switch (type) {
      case "loading":
        return {
          icon: <FileText className="h-12 w-12 text-muted-foreground/50" />,
          title: title || "Loading data...",
          description: description || "Please wait while we fetch your data",
        };
      case "no-data":
        return {
          icon: <FileText className="h-12 w-12 text-muted-foreground/50" />,
          title: title || "No data to display",
          description:
            description ||
            "Load a CSV file or connect to a data source to get started",
        };
      case "error":
        return {
          icon: <FileText className="h-12 w-12 text-destructive/50" />,
          title: title || "Failed to load data",
          description:
            description ||
            "There was an error loading your data. Please try again.",
        };
    }
  };

  const content = getContent();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4 max-w-md">
        {/* Icon */}
        <div className="p-4 rounded-full bg-muted/30">{content.icon}</div>

        {/* Content */}
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-foreground">
            {content.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {content.description}
          </p>
        </div>

        {/* Action */}
        {action && (
          <Button onClick={action.onClick} className="mt-4" size="sm">
            {action.icon}
            {action.label}
          </Button>
        )}

        {/* Quick Actions for no-data state */}
        {type === "no-data" && !action && (
          <div className="flex items-center gap-2 mt-4">
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" />
              Upload CSV
            </Button>
            <Button variant="outline" size="sm">
              <LinkIcon className="h-4 w-4" />
              Load from URL
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
