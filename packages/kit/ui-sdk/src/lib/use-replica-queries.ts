/**
 * React readings of the replica's query answers (`QueryAnswers`): one
 * query's answer, or what a pure reader makes of the answers it asks for.
 * Each keeps the queries it read live while it is mounted, and re-renders
 * when one of them is answered again or the replica moves.
 */
import {
  type DependencyList,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { EdnRunner } from "@kb/query";
import type { QueryRead, QueryAnswers } from "./replica-queries";

const NONE: QueryRead = { answer: null, current: false };

/** Listen to `a` and `b` at once. */
function both(
  a: (listener: () => void) => () => void,
  b: ((listener: () => void) => () => void) | null,
): (listener: () => void) => () => void {
  return (listener) => {
    const offA = a(listener);
    const offB = b?.(listener);
    return () => {
      offA();
      offB?.();
    };
  };
}

/**
 * `edn`'s answer in `queries`, kept live while mounted. `moves` is how the
 * replica says it moved, which is when an answer stops being current.
 */
export function useQueryReadThrough(
  queries: QueryAnswers | null,
  edn: string | null,
  moves: (listener: () => void) => () => void,
): QueryRead {
  useEffect(
    () => (queries === null || edn === null ? undefined : queries.watch(edn)),
    [queries, edn],
  );
  const subscribe = useMemo(
    () =>
      both(
        moves,
        queries === null || edn === null ? null : (listener) => queries.subscribeTo(edn, listener),
      ),
    [moves, queries, edn],
  );
  const snapshot = () => (queries === null || edn === null ? NONE : queries.read(edn));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** What a reader made of the answers it read, and whether every one of them is as of now. */
export interface Answered<T> {
  readonly value: T;
  readonly settled: boolean;
}

/** A snapshot, with the queries it read joined into one key, so the effect that watches them reads no ref. */
interface Snapshot<T> extends Answered<T> {
  readonly watched: string;
}

interface Run<T> {
  readonly queries: QueryAnswers | null;
  readonly deps: DependencyList;
  readonly reads: ReadonlyMap<string, QueryRead>;
  readonly result: Snapshot<T>;
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * What `read` answers over the queries it asks of `queries`, as React state:
 * read again when `deps` change, when an answer it read changes, or when the
 * replica moves (`moves`); the queries it read are kept live while mounted.
 * Until every one of them is answered as of now, `settled` is false and the
 * value is what the last answers make of it (a query never answered reads as
 * no rows).
 */
export function useAnsweredThrough<T>(
  queries: QueryAnswers | null,
  moves: (listener: () => void) => () => void,
  read: (run: EdnRunner) => T,
  deps: DependencyList,
): Answered<T> {
  const last = useRef<Run<T> | null>(null);
  const snapshot = (): Snapshot<T> => {
    const prev = last.current;
    if (
      prev !== null &&
      prev.queries === queries &&
      sameDeps(prev.deps, deps) &&
      [...prev.reads].every(([edn, at]) => queries?.read(edn) === at)
    ) {
      return prev.result;
    }
    const reads = new Map<string, QueryRead>();
    const value = read(queries === null ? () => [] : queries.runner(reads));
    const settled = queries !== null && [...reads.values()].every((at) => at.current);
    const watched = [...reads.keys()].toSorted().join("\u0000");
    const result = { value, settled, watched };
    last.current = { queries, deps, reads, result };
    return result;
  };
  const subscribe = useMemo(
    () => both(moves, queries === null ? null : (listener) => queries.subscribe(listener)),
    [moves, queries],
  );
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { watched } = result;
  useEffect(() => {
    if (queries === null || watched === "") return undefined;
    const releases = watched.split("\u0000").map((edn) => queries.watch(edn));
    return () => {
      for (const release of releases) release();
    };
  }, [queries, watched]);
  return result;
}

/**
 * `answered`'s value when it is settled, else the last settled value read for
 * the same `key`, else null: for a reader whose value before its queries are
 * answered is partial and must not be drawn (a graph that would lay out a few
 * nodes, then jump). `key` names what the value is of (a root, a view), so a
 * held value is never shown as the value of something else.
 */
export function useLastSettled<T>({ value, settled }: Answered<T>, key: string): T | null {
  const [held, setHeld] = useState<{ readonly key: string; readonly value: T } | null>(null);
  if (settled && (held === null || held.key !== key || held.value !== value)) {
    setHeld({ key, value });
  }
  if (settled) return value;
  return held !== null && held.key === key ? held.value : null;
}

/**
 * Which answers `queries` holds, as a number that moves when any arrives: for
 * a reader that reads the answers through code it does not own (a command's
 * `when`, a field's targets) and is drawn again when they move.
 */
export function useAnswersOf(queries: QueryAnswers | null): number {
  const subscribe = useMemo(
    () => (listener: () => void) => queries?.subscribe(listener) ?? (() => undefined),
    [queries],
  );
  const snapshot = () => queries?.version ?? 0;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
