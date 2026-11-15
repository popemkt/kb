/**
 * A table's calculation row (DESIGN-UI.md → Calculations): the calculations
 * a column offers, by its field's type, and what one makes of the column's
 * values. Pure, so the table that draws a result and the view settings that
 * offer a choice answer from one place.
 */
import type { FieldType, PropValue } from "@kb/model";

/** Every calculation, in the order a column offers them. */
export const CALCULATIONS = ["count", "sum", "average", "median", "min", "max"] as const;

export type Calculation = (typeof CALCULATIONS)[number];

/** A calculation's name, as a person reads it. */
export const CALCULATION_LABELS: Readonly<Record<Calculation, string>> = {
  count: "Count",
  sum: "Sum",
  average: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
};

/** The calculations a column of a field of `type` offers: count under any, the rest under a number. */
export function calculationsFor(type: FieldType): readonly Calculation[] {
  return type === "number" ? CALCULATIONS : ["count"];
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/**
 * `calc` over a column, given each row's first value of its field (absent
 * when the row holds none): `count` counts the rows that hold one, the rest
 * read the number values. Null when a number calculation has no number to
 * read.
 */
export function calculate(
  calc: Calculation,
  values: readonly (PropValue | undefined)[],
): number | null {
  if (calc === "count") return values.filter((value) => value !== undefined).length;
  const numbers = values.flatMap((value) => (value?.t === "num" ? [value.v] : []));
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, n) => total + n, 0);
  if (calc === "sum") return sum;
  if (calc === "average") return sum / numbers.length;
  if (calc === "min") return Math.min(...numbers);
  if (calc === "max") return Math.max(...numbers);
  return median(numbers.toSorted((a, b) => a - b));
}
