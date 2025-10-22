import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastMessage extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  showToast: (toast: ToastOptions) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: string }
> = {
  default: {
    container:
      "border border-border shadow-lg bg-popover text-popover-foreground supports-[backdrop-filter]:bg-background/90 backdrop-blur",
    icon: "text-primary",
  },
  success: {
    container:
      "border border-emerald-300/70 bg-emerald-100 text-emerald-900 shadow-lg dark:border-emerald-700/60 dark:bg-emerald-900/70 dark:text-emerald-50",
    icon: "text-emerald-500 dark:text-emerald-400",
  },
  error: {
    container:
      "border border-destructive/50 bg-destructive/15 text-destructive-foreground shadow-lg dark:border-destructive/60 dark:bg-destructive/25",
    icon: "text-destructive",
  },
};

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      if (typeof window !== "undefined") window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    ({ duration = 5000, variant = "default", ...rest }: ToastOptions) => {
      const id = generateId();
      setToasts((prev) => {
        const next = [...prev.slice(-3), { ...rest, variant, id }];
        return next;
      });
      if (duration > 0 && typeof window !== "undefined") {
        const timer = window.setTimeout(() => dismissToast(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const timers = timersRef.current;
    return () => {
      timers.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      dismissToast,
    }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[4000] flex flex-col items-end gap-3 p-4 sm:p-6">
      {toasts
        .slice()
        .reverse()
        .map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const { id, title, description, variant = "default" } = toast;
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.default;
  const Icon =
    variant === "success"
      ? CheckCircle2
      : variant === "error"
        ? OctagonAlert
        : Info;

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg p-4 transition-all",
        styles.container,
      )}
      role="status"
      aria-live="polite"
    >
      <span className={cn("mt-0.5 flex-shrink-0", styles.icon)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex-1 space-y-1">
        {title && <p className="font-semibold text-sm leading-none">{title}</p>}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
