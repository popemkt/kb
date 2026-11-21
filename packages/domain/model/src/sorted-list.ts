import type { Slots } from "./order.ts";
import { present } from "./present.ts";

/** One node of the tree: a member, its random heap priority, and how many members its subtree holds. */
interface Cell<T> {
  readonly value: T;
  readonly priority: number;
  size: number;
  left: Cell<T> | null;
  right: Cell<T> | null;
}

const cellOf = <T>(value: T, priority: number): Cell<T> => ({
  value,
  priority,
  size: 1,
  left: null,
  right: null,
});

/**
 * The next of a list's own priorities: xorshift32 over `state`. A treap
 * needs priorities spread like random ones, not unpredictable ones, so each
 * list draws a fixed sequence of its own and a plan replays exactly.
 */
function nextPriority(state: { seed: number }): number {
  let x = state.seed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.seed = x >>> 0;
  return state.seed;
}

const sizeOf = <T>(cell: Cell<T> | null): number => (cell === null ? 0 : cell.size);

function resized<T>(cell: Cell<T>): Cell<T> {
  cell.size = 1 + sizeOf(cell.left) + sizeOf(cell.right);
  return cell;
}

/** `a` then `b`, every member of `a` before every member of `b`. */
function merge<T>(a: Cell<T> | null, b: Cell<T> | null): Cell<T> | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.priority > b.priority) {
    a.right = merge(a.right, b);
    return resized(a);
  }
  b.left = merge(a, b.left);
  return resized(b);
}

/** The members `before` holds for, and the rest, in order. */
function split<T>(
  cell: Cell<T> | null,
  before: (value: T) => boolean,
): [Cell<T> | null, Cell<T> | null] {
  if (cell === null) return [null, null];
  if (before(cell.value)) {
    const [low, high] = split(cell.right, before);
    cell.right = low;
    return [resized(cell), high];
  }
  const [low, high] = split(cell.left, before);
  cell.left = high;
  return [low, resized(cell)];
}

/** The first `count` members, and the rest. */
function splitAt<T>(cell: Cell<T> | null, count: number): [Cell<T> | null, Cell<T> | null] {
  if (cell === null) return [null, null];
  const left = sizeOf(cell.left);
  if (count <= left) {
    const [low, high] = splitAt(cell.left, count);
    cell.left = high;
    return [low, resized(cell)];
  }
  const [low, high] = splitAt(cell.right, count - left - 1);
  cell.right = low;
  return [resized(cell), high];
}

/**
 * A list kept in a comparator's order, read by position: inserting, removing
 * and reading the member at an index each cost O(log n), where an array
 * costs O(n) moves to insert. A treap: a search tree on the order, a heap on
 * a pseudo-random priority per member (`nextPriority`), and each node's
 * subtree size for positions.
 *
 * Members that compare equal keep the order they were inserted in, the
 * later one after: an insert goes after every member below it (`lowerBound`).
 */
export class SortedList<T> implements Slots<T> {
  #root: Cell<T> | null = null;
  readonly #compare: (a: T, b: T) => number;
  readonly #priorities = { seed: 0x9e3779b9 };

  /** `sorted` (already in `compare`'s order) as a list, built in O(n). */
  constructor(compare: (a: T, b: T) => number, sorted: Iterable<T> = []) {
    this.#compare = compare;
    // A Cartesian tree over the members in order, built on a stack holding
    // its right spine: a cell is final, and sized, once it leaves the spine.
    const spine: Cell<T>[] = [];
    for (const value of sorted) {
      const cell = cellOf(value, nextPriority(this.#priorities));
      let last: Cell<T> | null = null;
      while (spine.length > 0 && present(spine.at(-1), "spine top").priority < cell.priority) {
        last = resized(present(spine.pop(), "spine top"));
      }
      cell.left = last;
      const parent = spine.at(-1);
      if (parent !== undefined) parent.right = cell;
      spine.push(cell);
    }
    for (const cell of spine.toReversed()) resized(cell);
    this.#root = spine[0] ?? null;
  }

  get length(): number {
    return sizeOf(this.#root);
  }

  at(index: number): T | undefined {
    let cell = this.#root;
    let i = index;
    while (cell !== null) {
      const left = sizeOf(cell.left);
      if (i < left) cell = cell.left;
      else if (i === left) return cell.value;
      else {
        i -= left + 1;
        cell = cell.right;
      }
    }
    return undefined;
  }

  /** The index at which `value` sits, or would be inserted: the count of members below it. */
  lowerBound(value: T): number {
    let cell = this.#root;
    let below = 0;
    while (cell !== null) {
      if (this.#compare(cell.value, value) < 0) {
        below += sizeOf(cell.left) + 1;
        cell = cell.right;
      } else cell = cell.left;
    }
    return below;
  }

  /** Put `value` in its place: after every member below it. */
  insert(value: T): void {
    const [low, high] = split(this.#root, (member) => this.#compare(member, value) < 0);
    this.#root = merge(merge(low, cellOf(value, nextPriority(this.#priorities))), high);
  }

  /**
   * Take out the first member at `value`'s place that `same` accepts, when
   * the first at that place is one; whether one was taken.
   */
  remove(value: T, same: (member: T) => boolean): boolean {
    const at = this.lowerBound(value);
    const found = this.at(at);
    if (found === undefined || !same(found)) return false;
    const [low, rest] = splitAt(this.#root, at);
    const [, high] = splitAt(rest, 1);
    this.#root = merge(low, high);
    return true;
  }
}
