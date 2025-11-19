import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex items-center justify-center font-mono text-xs font-medium border rounded px-1.5 py-0.5 min-w-[1.5rem]",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground border-border shadow-xs",
        outline: "bg-background text-foreground border-border shadow-sm",
      },
      size: {
        default: "h-5 min-w-[1.5rem] px-1.5",
        sm: "h-4 min-w-[1.25rem] px-1 text-[10px]",
        lg: "h-6 min-w-[1.75rem] px-2 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface KbdProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof kbdVariants> {
  keys?: string[];
  separator?: string;
}

const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  (
    { className, variant, size, keys, separator = "+", children, ...props },
    ref,
  ) => {
    if (keys && keys.length > 0) {
      return (
        <span className="inline-flex items-center gap-1" ref={ref}>
          {keys.map((key, index) => (
            <>
              <kbd
                key={index}
                className={cn(kbdVariants({ variant, size, className }))}
                aria-label={key}
                {...props}
              >
                {key}
              </kbd>
              {index < keys.length - 1 && (
                <span className="text-xs text-muted-foreground select-none">
                  {separator}
                </span>
              )}
            </>
          ))}
        </span>
      );
    }

    return (
      <kbd
        ref={ref}
        className={cn(kbdVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </kbd>
    );
  },
);

Kbd.displayName = "Kbd";

export { Kbd, kbdVariants };
