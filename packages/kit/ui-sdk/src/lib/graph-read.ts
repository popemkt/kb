/**
 * A component's read of the graph, subscribed to exactly what it read.
 *
 * The page holds the graph as whole values — the projection (`nodes`), the
 * schema it resolves against (`schemaOf`) and the replica's query answers
 * (`QueryAnswers`) — and every
 * graph change or expand replaces the maps. A row that selected a map would
 * re-render on every change anywhere. A row instead reads through a
 * {@link GraphRead}: the same three, as views that remember which node ids
 * were asked for (and whether a map was walked, or the answers read).
 *
 * The view keeps its identity for as long as every read it served is
 * unchanged in its {@link GraphSource}: the projection is persistent
 * (`wireToOutlineMap` keeps an unchanged node's object), so "unchanged" is
 * one identity comparison per id read (a schema entry by `sameMeaning`, since
 * a schema reader never asks about expansion). When any of them moves, the
 * component gets a new view and re-renders, and the new view starts recording
 * afresh. A map walk (`values()`, iteration, `size`) depends on the whole
 * map. A query read through the answers (`runner`, `read`) depends on that
 * query's answer, and is watched while the component is mounted, so a move
 * of the replica asks it again (`useAnswered` reads queries the same way);
 * any other use of the answers depends on every answer arriving.
 *
 * Reads always answer from the source's current maps, never from the
 * snapshot the view was made on; the recording only decides when the view is
 * renewed. So a read added later — a popup opening, a child rendering on its
 * own — is never stale, and is a dependency from then on. A view is handed
 * down as a prop like the values it stands for; what a child reads through it
 * is the owner's dependency, and a new view re-renders the child with it.
 *
 * This is the only way a component depends on more of the graph than one
 * value; it is a selector over the one graph, not a second copy of it. The
 * mechanism is one hook over a port, so the shell's outline store and the
 * page's `BrowserHost` are two bindings of one body.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sameMeaning } from "./graph-view";
import type { FieldContext, SchemaIndex } from "./schema";
import type { EdnRunner } from "../query";
import type { QueryAnswers, QueryRead } from "./replica-queries";
import type { NodeMap } from "./types";

/** The graph as a component reads it: the outline as shown, its schema, the query answers. */
export interface GraphRead extends FieldContext {
  readonly outline: NodeMap;
}

/**
 * Where a {@link GraphRead} reads from: a source to subscribe to and reads of
 * what it holds now. Each read returns the same value until what it reads
 * changes.
 */
export interface GraphSource {
  /** Listen for any change to what this source's reads answer; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Every node of the graph, as the page shows them: the rows of the projection it stands in. */
  readonly nodes: () => NodeMap;
  /** The graph's schema: fields, tags and their types. */
  readonly schema: () => SchemaIndex;
  /** The replica's query answers, or null before the graph has loaded. */
  readonly queries: () => QueryAnswers | null;
}

/** The store values a read stands on, as of one check. */
interface Sources {
  readonly outline: NodeMap;
  readonly schema: SchemaIndex;
  readonly queries: QueryAnswers | null;
  readonly answers: number;
}

function sourcesOf(source: GraphSource): Sources {
  const queries = source.queries();
  return {
    outline: source.nodes(),
    schema: source.schema(),
    queries,
    answers: queries?.version ?? 0,
  };
}

/** The ids a reader asked one map for; `whole` once it walked the map. */
class MapReads {
  readonly ids = new Set<string>();
  whole = false;

  /** Whether every read answers the same from `after` as from `before`, by `same`. */
  unchanged<V>(
    before: ReadonlyMap<string, V>,
    after: ReadonlyMap<string, V>,
    same: (a: V, b: V) => boolean,
  ): boolean {
    if (before === after) return true;
    if (this.whole) return false;
    for (const id of this.ids) {
      const a = before.get(id);
      const b = after.get(id);
      if (a !== b && (a === undefined || b === undefined || !same(a, b))) return false;
    }
    return true;
  }
}

function identical<V>(a: V, b: V): boolean {
  return a === b;
}

/**
 * `M` as a recording view over whichever map `current` returns: `get` and `has`
 * record their id; a walk (`size`, `keys`, `values`, `entries`, `forEach`,
 * iteration) records the whole map. It is a read: `M`'s writers are absent.
 */
function mapView<V, M extends ReadonlyMap<string, V>>(
  shape: M,
  current: () => ReadonlyMap<string, V>,
  reads: MapReads,
): M {
  const walk = (): ReadonlyMap<string, V> => {
    reads.whole = true;
    return current();
  };
  const get = (id: string): V | undefined => {
    reads.ids.add(id);
    return current().get(id);
  };
  const has = (id: string): boolean => {
    reads.ids.add(id);
    return current().has(id);
  };
  const keys = () => walk().keys();
  const values = () => walk().values();
  const entries = () => walk().entries();
  const iterate = () => walk()[Symbol.iterator]();
  const forEach = (each: (value: V, key: string, map: ReadonlyMap<string, V>) => void): void => {
    walk().forEach(each);
  };
  return new Proxy(shape, {
    get(_shape, member) {
      switch (member) {
        case "get":
          return get;
        case "has":
          return has;
        case "size":
          return walk().size;
        case "keys":
          return keys;
        case "values":
          return values;
        case "entries":
          return entries;
        case "forEach":
          return forEach;
        case Symbol.iterator:
          return iterate;
        case Symbol.toStringTag:
          return "Map";
        default:
          return undefined;
      }
    },
  });
}

/**
 * The query answers as a recording view: a query read (`read`, `runner`) is
 * recorded in `reads` with what it answered; any other use depends on every
 * answer arriving (`onRead`).
 */
class AnswersRead implements QueryAnswers {
  readonly #answers: QueryAnswers;
  readonly #onRead: () => void;
  readonly #reads: Map<string, QueryRead>;

  constructor(answers: QueryAnswers, reads: Map<string, QueryRead>, onRead: () => void) {
    this.#answers = answers;
    this.#reads = reads;
    this.#onRead = onRead;
  }

  #read(): QueryAnswers {
    this.#onRead();
    return this.#answers;
  }

  get version(): number {
    return this.#read().version;
  }
  subscribe(...args: Parameters<QueryAnswers["subscribe"]>): ReturnType<QueryAnswers["subscribe"]> {
    return this.#read().subscribe(...args);
  }
  subscribeTo(
    ...args: Parameters<QueryAnswers["subscribeTo"]>
  ): ReturnType<QueryAnswers["subscribeTo"]> {
    return this.#read().subscribeTo(...args);
  }
  read(edn: string): QueryRead {
    const read = this.#answers.read(edn);
    this.#reads.set(edn, read);
    return read;
  }
  watch(...args: Parameters<QueryAnswers["watch"]>): ReturnType<QueryAnswers["watch"]> {
    return this.#read().watch(...args);
  }
  moved(): void {
    this.#read().moved();
  }
  once(...args: Parameters<QueryAnswers["once"]>): ReturnType<QueryAnswers["once"]> {
    return this.#read().once(...args);
  }
  ask(...args: Parameters<QueryAnswers["ask"]>): ReturnType<QueryAnswers["ask"]> {
    return this.#read().ask(...args);
  }
  runner(reads?: Map<string, QueryRead>): EdnRunner {
    const run = this.#answers.runner(reads);
    return (edn) => {
      this.#reads.set(edn, this.#answers.read(edn));
      return run(edn);
    };
  }
  settle<T>(read: (run: EdnRunner) => T): Promise<T> {
    return this.#read().settle(read);
  }
}

/** One view and what it has served so far. */
class Reader {
  #sources: Sources;
  readonly #outline = new MapReads();
  readonly #schema = new MapReads();
  /** The queries read through the view, with what each answered. */
  readonly reads = new Map<string, QueryRead>();
  #queried = false;
  readonly view: GraphRead;

  get queries(): QueryAnswers | null {
    return this.#sources.queries;
  }

  constructor(sources: Sources) {
    this.#sources = sources;
    const queries = sources.queries;
    this.view = {
      outline: mapView(sources.outline, () => this.#sources.outline, this.#outline),
      schema: mapView(sources.schema, () => this.#sources.schema, this.#schema),
      queries:
        queries === null
          ? null
          : new AnswersRead(queries, this.reads, () => {
              this.#queried = true;
            }),
    };
  }

  /**
   * Move onto `next` when every read served so far answers the same there,
   * and say whether it did. The answers view is bound to one set of
   * answers, so a new one always needs a new view.
   */
  follow(next: Sources): boolean {
    const prev = this.#sources;
    if (next.queries !== prev.queries) return false;
    if (this.#queried && next.answers !== prev.answers) return false;
    // Reading a query that is not current asks it again (`QueryAnswers.read`).
    for (const [edn, at] of this.reads) if (next.queries?.read(edn) !== at) return false;
    if (!this.#outline.unchanged(prev.outline, next.outline, identical)) return false;
    // A schema entry is read for what it says, never for its expansion — an
    // unscoped schema's entries are the projection's (`lib/schema.ts`), so an
    // expand since the last snapshot is not a change to a schema reader.
    if (!this.#schema.unchanged(prev.schema, next.schema, sameMeaning)) return false;
    this.#sources = next;
    return true;
  }
}

/** A component's current reader; replaced when a read it served changed. */
class ReaderSlot {
  #reader: Reader | null = null;

  /** The answers the current reader read queries of, and those queries, as one key. */
  watched(): { readonly queries: QueryAnswers | null; readonly key: string } {
    const reader = this.#reader;
    if (reader === null) return { queries: null, key: "" };
    return { queries: reader.queries, key: [...reader.reads.keys()].toSorted().join("\u0000") };
  }

  readonly snapshot = (source: GraphSource): GraphRead => {
    const next = sourcesOf(source);
    const reader = this.#reader;
    if (reader !== null && reader.follow(next)) return reader.view;
    const fresh = new Reader(next);
    this.#reader = fresh;
    return fresh.view;
  };
}

/** The graph of `source`, read by this component: it re-renders when what it read changes. */
export function useGraphReadThrough(source: GraphSource): GraphRead {
  const [slot] = useState(() => new ReaderSlot());
  const snapshot = () => slot.snapshot(source);
  const view = useSyncExternalStore(source.subscribe, snapshot, snapshot);
  useWatchedQueries(slot);
  return view;
}

/**
 * Keep the queries the slot's reader read live while mounted. They are read
 * during render, after the snapshot, so they are looked at after every
 * render, and watched again only when they change.
 */
interface Held {
  readonly queries: QueryAnswers | null;
  readonly key: string;
  readonly releases: ReadonlyArray<() => void>;
}

function releaseHeld(held: { current: Held | null }): void {
  for (const done of held.current?.releases ?? []) done();
  held.current = null;
}

function useWatchedQueries(slot: ReaderSlot): void {
  const held = useRef<Held | null>(null);
  useEffect(() => {
    const { queries, key } = slot.watched();
    const prev = held.current;
    if (prev !== null && prev.queries === queries && prev.key === key) return;
    releaseHeld(held);
    if (queries === null || key === "") return;
    held.current = {
      queries,
      key,
      releases: key.split("\u0000").map((edn) => queries.watch(edn)),
    };
  });
  useEffect(() => () => releaseHeld(held), []);
}
