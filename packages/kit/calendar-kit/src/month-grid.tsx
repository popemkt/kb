import type { ReactNode } from "react";
import { WEEKDAY_SHORT } from "./days";

/**
 * The weeks of a month, Monday first, as every calendar lays them out: the
 * weekdays' names over `children`, a cell per day of the month's days
 * (`daysOf("month", …)`), in order.
 */
export function MonthGrid({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-calendar-layout="month">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_SHORT.map((name) => (
          <div key={name} className="py-1 text-center text-label text-muted-foreground">
            {name}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7 border-r border-border">{children}</div>
    </div>
  );
}
