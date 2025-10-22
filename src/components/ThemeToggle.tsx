import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark"
      ? (saved as "light" | "dark")
      : "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Toggle theme (current: ${theme})`}
            onClick={toggle}
          >
            <AnimatePresence mode="wait" initial={false}>
              {theme === "dark" ? (
                <motion.div
                  key="sun"
                  initial={
                    prefersReducedMotion ? {} : { rotate: -90, scale: 0 }
                  }
                  animate={prefersReducedMotion ? {} : { rotate: 0, scale: 1 }}
                  exit={prefersReducedMotion ? {} : { rotate: 90, scale: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Sun className="size-4" />
                </motion.div>
              ) : (
                <motion.div
                  key="moon"
                  initial={prefersReducedMotion ? {} : { rotate: 90, scale: 0 }}
                  animate={prefersReducedMotion ? {} : { rotate: 0, scale: 1 }}
                  exit={prefersReducedMotion ? {} : { rotate: -90, scale: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Moon className="size-4" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Toggle theme ({theme === "dark" ? "Dark" : "Light"})</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
