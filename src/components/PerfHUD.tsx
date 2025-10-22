import { useEffect, useState } from "react";
import { isPerfEnabled, onPerf, type PerfEvent } from "@/lib/perf";

interface CommitSample {
  ts: number;
  ms: number;
  component: string;
}

export function PerfHUD() {
  const [samples, setSamples] = useState<CommitSample[]>([]);
  const [visibleRows, setVisibleRows] = useState<number | null>(null);

  useEffect(() => {
    if (!isPerfEnabled()) return;
    return onPerf((ev: PerfEvent) => {
      if (ev.type === "commit") {
        setSamples((prev) => {
          const next = prev.concat({
            ts: Date.now(),
            ms: ev.ms,
            component: ev.component,
          });
          return next.slice(Math.max(0, next.length - 10));
        });
        if (typeof ev.extra?.visibleRows === "number") {
          setVisibleRows(ev.extra.visibleRows as number);
        }
      }
    });
  }, []);

  if (!isPerfEnabled()) return null;

  const last = samples[samples.length - 1];
  type HeapStats = { usedJSHeapSize: number; jsHeapSizeLimit: number };
  const performanceWithMemory =
    typeof globalThis.performance !== "undefined"
      ? (globalThis.performance as Performance & { memory?: HeapStats })
      : undefined;
  const mem = performanceWithMemory?.memory;
  const used = mem ? Math.round(mem.usedJSHeapSize / (1024 * 1024)) : null;
  const limit = mem ? Math.round(mem.jsHeapSizeLimit / (1024 * 1024)) : null;

  return (
    <div className="ml-3 text-[11px] text-muted-foreground whitespace-nowrap">
      <span>Perf:</span>
      {last && (
        <span className="ml-1">
          {last.component} {last.ms.toFixed(1)}ms
        </span>
      )}
      {visibleRows != null && <span className="ml-2">rows {visibleRows}</span>}
      {used != null && limit != null && (
        <span className="ml-2">
          mem {used} / {limit} MB
        </span>
      )}
    </div>
  );
}
