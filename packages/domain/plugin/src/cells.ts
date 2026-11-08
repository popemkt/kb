/** One registration address, shared by service slots and point cells. */
export interface Cell<T> {
  readonly entries: T[];
}

export function cell<T>(entry: T): Cell<T> {
  return { entries: [entry] };
}

export function cellEntries<T>(cells: readonly Cell<T>[]): T[] {
  return cells.flatMap(({ entries }) => entries);
}
