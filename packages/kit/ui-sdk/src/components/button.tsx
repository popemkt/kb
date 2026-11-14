import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-background text-foreground hover:bg-foreground/[0.06]",
  destructive: "border border-destructive/40 text-destructive hover:bg-destructive/10",
  ghost: "text-foreground/60 hover:bg-foreground/[0.06]",
} as const;

/** Shared text actions, including approval decisions. */
export function Button({
  variant = "secondary",
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  readonly variant?: keyof typeof VARIANTS;
}) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
        "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
    />
  );
}
