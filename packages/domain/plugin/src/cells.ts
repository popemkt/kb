/** One admitted registration, with its host-bound provider identity. */
export interface Registration<T> {
  readonly owner: string;
  readonly provider: string;
  readonly identity: object;
  readonly priority: number;
  readonly default: boolean;
  readonly value: T;
}

/** A registration address: services and point cells use the same election. */
export interface Cell<T> {
  readonly role: string | null;
  readonly entries: Registration<T>[];
  /** The owner's canonical address survives while a replacement still holds the cell. */
  default: Registration<T> | null;
}

export function registrationCell<T>(entry: Registration<T>, role: string | null): Cell<T> {
  return { role, entries: [entry], default: entry.default ? entry : null };
}

export function cellEntries<T>(cells: readonly Cell<T>[]): Registration<T>[] {
  return cells.flatMap(({ entries }) => entries);
}

/** Lower priority wins; stable sort preserves registration order on a tie. */
export function elect<T>(
  cell: Cell<T>,
  selected: string | undefined,
  eligible: (entry: Registration<T>) => boolean,
): Registration<T> | undefined {
  if (cell.role === null) return cell.entries[0];
  const candidates = cell.entries.filter(eligible);
  return (
    candidates.find(({ provider }) => provider === selected) ??
    candidates.toSorted((a, b) => a.priority - b.priority)[0]
  );
}

export function addCandidate<T>(cell: Cell<T>, candidate: Registration<T>): void {
  cell.entries.push(candidate);
  if (candidate.default) cell.default = candidate;
}

export function removeCandidate<T>(cell: Cell<T>, candidate: Registration<T>): void {
  cell.entries.splice(cell.entries.indexOf(candidate), 1);
}
