/**
 * The kb functions: compiled to function inputs (compile stays pure), bound
 * by the executor over one clock sample per run, and answering in the run's
 * time zone. Semantic examples run on kb's index with the clock pinned.
 */
// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim lives beside the module that imports it
/// <reference path="../src/datascript.d.ts" />
import * as d from "datascript";
import { DatalogError, DatascriptIndex, compile, derivedWith, parseEdn } from "@kb/query";
import type { ClockSample, KbNode } from "@kb/model";
import { describe, expect, test } from "bun:test";

/** 2026-10-20T22:30:00Z: already the 21st in Amsterdam (UTC+2), still the 20th in UTC. */
const NOW = Date.UTC(2026, 9, 20, 22, 30);

function node(id: string, extra: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: extra.text ?? id,
    props: extra.props ?? {},
    children: [],
    createdAt: extra.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: extra.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

const due = (v: string) => ({ due: [{ t: "str" as const, v }] });

const NODES = [
  node("overdue", { props: due("2026-10-19") }),
  node("utc-today", { props: due("2026-10-20") }),
  node("ams-today", { props: due("2026-10-21") }),
  node("in-14", { props: due("2026-11-04") }),
  node("in-15", { props: due("2026-11-05") }),
  node("fresh", { text: "Fresh RETRO", createdAt: "2026-10-18T09:00:00.000Z" }),
  node("stale", { text: "old retro", createdAt: "2026-10-01T09:00:00.000Z" }),
  node("future", { text: "x", createdAt: "2026-10-30T00:00:00.000Z" }),
];

/** An index whose clock is pinned at `NOW` in `timeZone`, counting the samples taken. */
function pinned(timeZone: string): { index: DatascriptIndex; samples: () => number } {
  let samples = 0;
  const clock = (): ClockSample => {
    samples += 1;
    return { nowMs: NOW, timeZone };
  };
  return {
    index: new DatascriptIndex(NODES, { derived: derivedWith({}), clock }),
    samples: () => samples,
  };
}

function ids(index: DatascriptIndex, edn: string): unknown[] {
  expect(parseEdn(edn).kind).toBe("query");
  return index
    .runDatalog(edn)
    .map((row) => row[0])
    .toSorted((x, y) => String(x).localeCompare(String(y)));
}

const q = (where: string) => `[:find ?id :where [?n :node/id ?id] ${where}]`;

const ci = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase().includes(b.toLowerCase());

describe("DataScript 1.8.1 calls a function passed as an input", () => {
  const db = d.init_db([
    [1, ":t", "Hello"],
    [2, ":t", "world"],
  ]);

  test("in predicate position", () => {
    expect(
      d.q('[:find ?t :in $ ?__kb_fn_x :where [?e ":t" ?t] [(?__kb_fn_x ?t "HEL")]]', db, ci),
    ).toEqual([["Hello"]]);
  });

  test("in binding position", () => {
    const rows = d.q(
      '[:find ?t ?out :in $ ?__kb_fn_y :where [?e ":t" ?t] [(?__kb_fn_y 7) ?out]]',
      db,
      (n: number) => n + 1,
    );
    const sorted = (rows as [string, number][]).toSorted(([a], [b]) => a.localeCompare(b));
    expect(sorted).toEqual([
      ["Hello", 8],
      ["world", 8],
    ]);
  });
});

describe("compile names the function inputs and builds none", () => {
  test("each kb function is one :in slot after the others, in first-use order", () => {
    const ir = parseEdn(
      '[:find ?id :in $ ?x :where [?n :node/id ?id] [?n :node/text ?t] [(kb/includes-ci? ?t ?x)] [(kb/today) ?d] [(kb/includes-ci? ?t "a")]]',
    );
    const compiled = compile(ir);
    expect(compiled.functions).toEqual(["kb/includes-ci?", "kb/today"]);
    expect(compiled.query).toContain(":in $ ?x ?__kb_fn_includes-ci_q ?__kb_fn_today :where");
    expect(compiled.query).toContain("[(?__kb_fn_includes-ci_q ?t ?x)]");
    expect(compiled.query).not.toContain("kb/");
  });

  test("a query without kb functions has none", () => {
    expect(compile(parseEdn("[:find ?n :where [?n :node/text _]]")).functions).toBeUndefined();
  });
});

describe("civil dates are read in the run's time zone", () => {
  test("kb/today is the zone's today", () => {
    const today = q("[?n :f/due ?d] [(kb/today) ?t] [(= ?d ?t)]");
    expect(ids(pinned("Europe/Amsterdam").index, today)).toEqual(["ams-today"]);
    expect(ids(pinned("UTC").index, today)).toEqual(["utc-today"]);
  });

  test("within the next 14 days is today through today + 14, so an overdue date is not in it", () => {
    const window = q(
      "[?n :f/due ?v] [(kb/today) ?s1] [(kb/date-in-days 14) ?s2] [(<= ?s1 ?v)] [(<= ?v ?s2)]",
    );
    expect(ids(pinned("Europe/Amsterdam").index, window)).toEqual(["ams-today", "in-14"]);
    expect(ids(pinned("UTC").index, window)).toEqual(["ams-today", "utc-today"]);
  });

  test("a negative offset counts back across a month", () => {
    const edn = "[:find ?d :where [(kb/date-in-days -21) ?d]]";
    expect(pinned("UTC").index.runDatalog(edn)).toEqual([["2026-09-29"]]);
  });
});

describe("instants are ISO-8601 in UTC, as created and edited are", () => {
  test("in the last 7 days ends at now, so a future instant is not in it", () => {
    const recent = q(
      "[?n :node/created-at ?c] [(kb/instant-days-ago 7) ?s1] [(kb/instant-now) ?s2] [(<= ?s1 ?c)] [(<= ?c ?s2)]",
    );
    expect(ids(pinned("Europe/Amsterdam").index, recent)).toEqual(["fresh"]);
  });

  test("kb/instant-now is the sample's instant", () => {
    const rows = pinned("Asia/Tokyo").index.runDatalog(
      "[:find ?now :where [(kb/instant-now) ?now]]",
    );
    expect(rows).toEqual([["2026-10-20T22:30:00.000Z"]]);
  });
});

describe("kb/includes-ci? ignores case", () => {
  test("text contains, whatever the case; exact case stays includes?", () => {
    const { index } = pinned("UTC");
    expect(ids(index, q('[?n :node/text ?x] [(kb/includes-ci? ?x "retro")]'))).toEqual([
      "fresh",
      "stale",
    ]);
    expect(ids(index, q('[?n :node/text ?x] [(clojure.string/includes? ?x "retro")]'))).toEqual([
      "stale",
    ]);
  });

  test("false for a value that is not a string", () => {
    const { index } = pinned("UTC");
    expect(ids(index, q('[?n :node/created-at _] [(kb/includes-ci? 3 "3")]'))).toEqual([]);
  });
});

describe("a kb function inside or-join and not-join", () => {
  test("is joined in, so the -join sees its input", () => {
    const { index } = pinned("UTC");
    expect(
      ids(
        index,
        q(
          '(or-join [?n] (and [?n :node/text ?x] [(kb/includes-ci? ?x "RETRO")]) [?n :f/due "2026-10-19"])',
        ),
      ),
    ).toEqual(["fresh", "overdue", "stale"]);
    expect(
      ids(
        index,
        q('[?n :node/text ?t] (not-join [?n] [?n :node/text ?x] [(kb/includes-ci? ?x "retro")])'),
      ),
    ).toEqual(["ams-today", "future", "in-14", "in-15", "overdue", "utc-today"]);
  });

  test("nested, and only once per vector", () => {
    const compiled = compile(
      parseEdn(
        '[:find ?id :where [?n :node/id ?id] (not-join [?n] (or-join [?n] (and [?n :node/text ?x] [(kb/includes-ci? ?x "a")] [(kb/includes-ci? ?x "b")]) [?n :node/text "c"]))]',
      ),
    );
    expect(compiled.query).toContain(
      "(not-join [?n ?__kb_fn_includes-ci_q] (or-join [?n ?__kb_fn_includes-ci_q]",
    );
  });

  test("a clocked function, in or-join and in not-join, reads the run's one sample", () => {
    const { index, samples } = pinned("UTC");
    expect(
      ids(
        index,
        q('(or-join [?n] (and [?n :f/due ?d] [(kb/today) ?t] [(= ?d ?t)]) [?n :node/text "x"])'),
      ),
    ).toEqual(["future", "utc-today"]);
    expect(samples()).toBe(1);
    expect(
      ids(
        index,
        q("[?n :f/due ?d] (not-join [?n] [?n :f/due ?e] [(kb/date-in-days 14) ?s] [(<= ?e ?s)])"),
      ),
    ).toEqual(["in-14", "in-15"]);
    expect(samples()).toBe(2);
  });

  test("runs nested either way round: a not-join in an or-join, an or-join in a not-join", () => {
    const { index } = pinned("UTC");
    expect(
      ids(
        index,
        q(
          '(or-join [?n] (and [?n :node/text ?x] (not-join [?n ?x] [(kb/includes-ci? ?x "fresh")]) [(kb/includes-ci? ?x "retro")]) (and [?n :f/due ?d] [(kb/today) ?t] [(= ?d ?t)]))',
        ),
      ),
    ).toEqual(["stale", "utc-today"]);
    expect(
      ids(
        index,
        q(
          '[?n :node/text ?t] (not-join [?n] (or-join [?n] (and [?n :node/text ?x] [(kb/includes-ci? ?x "retro")]) (and [?n :f/due ?d] [(kb/today) ?s] [(< ?d ?s)])))',
        ),
      ),
    ).toEqual(["ams-today", "future", "in-14", "in-15", "utc-today"]);
  });

  test("a plain or calling one in a single branch needs no vector", () => {
    const { index } = pinned("UTC");
    expect(
      ids(index, q('[?n :node/text ?x] (or [(kb/includes-ci? ?x "retro")] [(= ?x "x")])')),
    ).toEqual(["fresh", "future", "stale"]);
  });
});

describe("one clock sample per run, and none without a clocked function", () => {
  test("a run calling two clocked functions over many rows samples once", () => {
    const { index, samples } = pinned("UTC");
    index.runDatalog(q("[?n :f/due ?v] [(kb/today) ?s1] [(kb/date-in-days 14) ?s2] [(<= ?s1 ?v)]"));
    expect(samples()).toBe(1);
    index.runDatalog(q("[(kb/instant-now) ?s]"));
    expect(samples()).toBe(2);
  });

  test("kb/includes-ci? alone, or no kb function, takes no sample", () => {
    const { index, samples } = pinned("UTC");
    index.runDatalog(q('[?n :node/text ?x] [(kb/includes-ci? ?x "a")]'));
    index.runDatalog(q("[?n :node/text _]"));
    expect(samples()).toBe(0);
  });

  test("an index without a clock answers unclocked queries and refuses a clocked one by name", () => {
    const bare = new DatascriptIndex(NODES, { derived: derivedWith({}) });
    expect(ids(bare, q('[?n :node/text ?x] [(kb/includes-ci? ?x "RETRO")]'))).toEqual([
      "fresh",
      "stale",
    ]);
    const clocked = q("[?n :f/due ?v] [(kb/today) ?t] [(= ?v ?t)]");
    expect(() => bare.runDatalog(clocked)).toThrow(DatalogError);
    expect(() => bare.runDatalog(clocked)).toThrow(/kb\/today reads the clock/);
  });
});

describe("a day offset is a whole number", () => {
  test.each(['"3"', "1.5"])("(kb/date-in-days %s) is a DatalogError", (arg) => {
    const edn = `[:find ?d :where [(kb/date-in-days ${arg}) ?d]]`;
    expect(() => pinned("UTC").index.runDatalog(edn)).toThrow(DatalogError);
    expect(() => pinned("UTC").index.runDatalog(edn)).toThrow(/whole number of days/);
  });

  test("an unknown time zone is a DatalogError naming it", () => {
    expect(() =>
      pinned("Mars/Olympus").index.runDatalog("[:find ?d :where [(kb/today) ?d]]"),
    ).toThrow(/Mars\/Olympus is not a time zone/);
  });
});
