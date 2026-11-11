/**
 * A refused write as a person reads it (`personRefusal`): what the node is
 * called, who owns it and what they can do instead, never an id the graph
 * can name or the override, which is its owner's. A failure that is not a
 * refusal reads as its message (`failureText`).
 */
import { describe, expect, it } from "vitest";
import { writeRefusalMessage, type WriteRefusal } from "@kb/model";
import { failureText, personRefusal, type RefusalNames } from "./refusal";

const LABELS: Readonly<Record<string, string>> = {
  "sys.tag.routine": "event",
  "sys.extensions": "Extensions",
  "sys.f.fields": "fields",
  "sys.f.views": "views",
};
const OWNERS: Readonly<Record<string, string>> = {
  "sys.tag.routine": "Events",
  "sys.extensions": "Core",
};
const names: RefusalNames = {
  label: (id) => LABELS[id] ?? id,
  owner: (id) => OWNERS[id] ?? null,
};

const REFUSALS: readonly WriteRefusal[] = [
  { rule: "virtual", id: "sys.extensions" },
  { rule: "mint", id: "sys.new" },
  { rule: "rank", id: "sys.tag.routine" },
  { rule: "stamp", id: "sys.tag.routine" },
  { rule: "children", id: "sys.extensions" },
  { rule: "list", id: "sys.tag.routine", field: "sys.f.fields" },
  { rule: "setting", id: "sys.tag.routine", field: "sys.f.views" },
  { rule: "delete", id: "sys.tag.routine" },
];

describe("a refused write, worded for a person", () => {
  it("names the node by its label, never the override", () => {
    for (const refusal of REFUSALS) {
      const text = personRefusal(refusal, names);
      expect(text, refusal.rule).not.toMatch(/force|override/);
      if (refusal.rule !== "mint") expect(text, refusal.rule).not.toContain(refusal.id);
    }
  });

  it("says who owns it, and what to do instead", () => {
    expect(personRefusal({ rule: "delete", id: "sys.tag.routine" }, names)).toBe(
      "event comes with Events, so it can't be deleted. You can add your own beside it.",
    );
    expect(personRefusal({ rule: "children", id: "sys.extensions" }, names)).toBe(
      "Extensions keeps what Core put in it, in that order. You can add your own here, and move or remove those.",
    );
    expect(
      personRefusal({ rule: "list", id: "sys.tag.routine", field: "sys.f.fields" }, names),
    ).toBe(
      "event keeps the fields Events gave it, in that order. You can add your own, or make your own tag that extends it.",
    );
    expect(
      personRefusal({ rule: "setting", id: "sys.tag.routine", field: "sys.f.views" }, names),
    ).toBe("Events sets the views of event.");
  });

  it("says kb owns a node no family seeds", () => {
    expect(personRefusal({ rule: "delete", id: "sys.extension.core" }, names)).toBe(
      "sys.extension.core comes with kb, so it can't be deleted. You can add your own beside it.",
    );
  });

  it("reads a refusal off a forbidden failure, and anything else as its message", () => {
    const refusal: WriteRefusal = { rule: "delete", id: "sys.tag.routine" };
    const refused = {
      code: "forbidden",
      message: writeRefusalMessage(refusal),
      details: { ...refusal, action: "node.delete" },
    };
    // Outside a page, ids are the names it has.
    expect(failureText(refused)).toBe(
      "sys.tag.routine comes with kb, so it can't be deleted. You can add your own beside it.",
    );
    expect(
      failureText({ code: "forbidden", message: "out of reach", details: { grant: [] } }),
    ).toBe("out of reach");
    expect(failureText({ code: "not_found", message: "no such node" })).toBe("no such node");
    expect(failureText({ message: "it failed" })).toBe("it failed");
  });
});
