/**
 * What every calendar draws a day's entries and cells with, so two calendars
 * read as one family (DESIGN-UI.md → Calendar): the class lists, as Tailwind
 * reads them whole.
 */

/** A chip in a day: its radius, inked left edge, label type and density. A chip adds its ink. */
export const calendarChipClass =
  "flex w-full min-w-0 cursor-pointer touch-none select-none gap-1 overflow-hidden rounded-sm border-l-2 px-1 text-left text-label leading-tight text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The ink of a chip that belongs to no calendar. */
export const calendarChipInk = "border-primary bg-primary/10";

/** A day's cell in a month's grid. */
export const monthCellClass =
  "flex min-h-20 min-w-0 flex-col gap-px border-b border-l border-border p-0.5";
