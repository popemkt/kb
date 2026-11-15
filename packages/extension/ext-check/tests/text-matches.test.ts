/**
 * `textMatchesOf` finds where a stored query names a node by its text
 * (AGENTS.md → Data-plane freedom, "Everything references by id"), the
 * reading `ext.check.audit`'s `ref-by-text` stands on. Red case: drop the
 * predicate walk, and the `=` cases below stop being found.
 */
import { describe, expect, test } from "bun:test";
import { textMatchesOf } from "../src/text-matches.ts";

describe("a query's matches on node text", () => {
  test("a pattern holding a literal is a match", () => {
    expect(textMatchesOf('[:find ?n :where [?n :node/text "todo"]]')).toEqual(["todo"]);
  });

  test("an equality over a variable bound to node text is a match, either way round", () => {
    expect(textMatchesOf('[:find ?n :where [?n :node/text ?t] [(= ?t "todo")]]')).toEqual(["todo"]);
    expect(textMatchesOf('[:find ?n :where [?n :node/text ?t] [(not= "done" ?t)]]')).toEqual([
      "done",
    ]);
  });

  test("matches inside or and not are found, and a source-qualified pattern too", () => {
    expect(
      textMatchesOf(
        '[:find ?n :where (or [?n :node/id "x"] [?n :node/text "x"]) (not [$ ?n :node/text "y"])]',
      ),
    ).toEqual(["x", "y"]);
  });

  test("a query that names nodes by id, or binds text only to show it, matches nothing", () => {
    expect(
      textMatchesOf(
        '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/id "01KZFW1A5BT06QS7V6X6EBQMZ4"] [?n :node/id ?id] [?n :node/text ?text]]',
      ),
    ).toEqual([]);
  });

  test("contains, starts-with and ends-with are search, not a reference", () => {
    expect(
      textMatchesOf(
        '[:find ?n :where [?n :node/text ?t] [(clojure.string/includes? ?t "todo")] [(clojure.string/starts-with? ?t "a")]]',
      ),
    ).toEqual([]);
  });

  test("an equality over a variable bound to something else is not a text match", () => {
    expect(textMatchesOf('[:find ?n :where [?n :f/status ?s] [(= ?s "todo")]]')).toEqual([]);
  });

  test("text that is not one datalog query matches nothing", () => {
    expect(textMatchesOf("[:find ?n :where")).toEqual([]);
    expect(textMatchesOf("")).toEqual([]);
    expect(textMatchesOf('[?n :node/text "todo"]')).toEqual([]);
    expect(textMatchesOf('the query used [?n :node/text "todo"] once')).toEqual([]);
  });
});
