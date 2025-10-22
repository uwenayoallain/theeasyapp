import { Slot, type SlotProps } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonMotionProps = VariantProps<typeof buttonVariants> &
  HTMLMotionProps<"button"> & {
    asChild?: false;
  };

type ButtonSlotProps = VariantProps<typeof buttonVariants> &
  SlotProps & {
    asChild: true;
  };

type ButtonProps = ButtonMotionProps | ButtonSlotProps;

const isSlotProps = (props: ButtonProps): props is ButtonSlotProps =>
  props.asChild === true;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, ref) => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animationProps: Partial<HTMLMotionProps<"button">> =
      prefersReducedMotion
        ? {}
        : {
            whileHover: { scale: 1.02 },
            whileTap: { scale: 0.98 },
            transition: {
              type: "spring" as const,
              stiffness: 400,
              damping: 17,
            },
          };

    if (isSlotProps(props)) {
      const { className, variant, size, asChild, ...slotProps } = props;
      void asChild;
      return (
        <Slot
          ref={ref}
          data-slot="button"
          className={cn(buttonVariants({ variant, size, className }))}
          {...slotProps}
        />
      );
    }

    const { className, variant, size, asChild, ...buttonProps } = props;
    void asChild;

    return (
      <motion.button
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...animationProps}
        {...buttonProps}
      />
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
