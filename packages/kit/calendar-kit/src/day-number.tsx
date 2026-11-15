import { dayOfMonth } from "./days";

/**
 * A day's number in a layout's header or cell: today's on the primary fill,
 * every other day's in the text colour it is given.
 */
export function DayNumber({
  day,
  today,
  muted = false,
}: {
  readonly day: string;
  readonly today: string;
  /** A day outside the month the layout shows. */
  readonly muted?: boolean;
}) {
  if (day === today)
    return (
      <span className="rounded-full bg-primary px-1.5 text-primary-foreground tabular-nums">
        {dayOfMonth(day)}
      </span>
    );
  return muted ? (
    <span className="px-1.5 text-faint-foreground tabular-nums">{dayOfMonth(day)}</span>
  ) : (
    <span className="px-1.5 text-foreground tabular-nums">{dayOfMonth(day)}</span>
  );
}
