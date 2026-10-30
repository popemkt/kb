import type { ReactNode } from "react";
import { HeldStill } from "../lib/motion";

/**
 * A subtree that holds still whatever the motion mode (`HeldStill`): script
 * motion reads it through `useReducedMotion`, CSS through the element's
 * `data-motion`, so what it draws is the still reduced motion draws.
 */
export function HoldStill({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <HeldStill.Provider value={true}>
      <span data-motion="reduced" className={className}>
        {children}
      </span>
    </HeldStill.Provider>
  );
}
