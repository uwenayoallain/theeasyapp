import { logger } from "@/lib/logger";

export type PerfEvent =
  | {
      type: "commit";
      component: string;
      ms: number;
      extra?: Record<string, unknown>;
    }
  | {
      type: "csv";
      phase: "start" | "batch" | "flush" | "done";
      ms?: number;
      rows?: number;
      loaded?: number;
      total?: number;
    };

type CsvPerfEvent = Extract<PerfEvent, { type: "csv" }>;

type Listener = (ev: PerfEvent) => void;

let listeners: Listener[] = [];

export function isPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("perf") === "1") return true;
  } catch (error) {
    logger.warn("Perf: failed to read perf= query flag", error);
  }
  try {
    return localStorage.getItem("dev.perf") === "1";
  } catch (error) {
    logger.warn("Perf: failed to read dev.perf flag from localStorage", error);
  }
  return false;
}

export function onPerf(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emit(ev: PerfEvent) {
  if (!isPerfEnabled()) return;
  for (const l of listeners) l(ev);
  if (ev.type === "commit") {
    if (process.env.NODE_ENV !== "production") {
      logger.debug(
        `[perf] ${ev.component} commit: ${ev.ms.toFixed(2)}ms`,
        ev.extra ?? "",
      );
    }
  }
}

export function mark(name: string) {
  if (!isPerfEnabled()) return;
  try {
    performance.mark(name);
  } catch (error) {
    logger.warn("Perf: performance.mark unavailable", error);
  }
}

export function measure(
  name: string,
  start?: string,
  end?: string,
): number | null {
  if (!isPerfEnabled()) return null;
  try {
    const endMark = end ?? `${name}:end`;
    const startMark = start ?? `${name}:start`;
    if (!end) performance.mark(endMark);
    const m = performance.measure(name, startMark, endMark);
    return m.duration;
  } catch {
    return null;
  }
}

export function recordCommit(
  component: string,
  startTime: number,
  extra?: Record<string, unknown>,
) {
  if (!isPerfEnabled()) return;
  const ms = performance.now() - startTime;
  emit({ type: "commit", component, ms, extra });
}

export function csvEvent(
  phase: CsvPerfEvent["phase"],
  info?: Omit<CsvPerfEvent, "type" | "phase">,
) {
  if (!isPerfEnabled()) return;
  const event: CsvPerfEvent = { type: "csv", phase, ...(info ?? {}) };
  emit(event);
  if (process.env.NODE_ENV !== "production") {
    logger.debug(`[perf] csv:${phase}`, info ?? "");
  }
}
