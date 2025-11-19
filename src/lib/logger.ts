const isProduction = process.env.NODE_ENV === "production";

type ConsoleArgs = unknown[];

const safeInvoke = (level: keyof Console, args: ConsoleArgs) => {
  const fn = console[level] as ((...data: ConsoleArgs) => void) | undefined;
  if (typeof fn === "function") {
    fn(...args);
  }
};

export const logger = {
  log: (...args: ConsoleArgs) => {
    if (!isProduction) {
      safeInvoke("log", args);
    }
  },
  info: (...args: ConsoleArgs) => {
    if (!isProduction) {
      safeInvoke("info", args);
    }
  },
  debug: (...args: ConsoleArgs) => {
    if (!isProduction) {
      safeInvoke("debug", args);
    }
  },
  warn: (...args: ConsoleArgs) => {
    safeInvoke("warn", args);
  },
  error: (...args: ConsoleArgs) => {
    safeInvoke("error", args);
  },
};
