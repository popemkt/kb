/**
 * Paste and drop (DESIGN-UI.md → Paste and drop): by priority, the first
 * handler whose match holds and that makes something claims a gesture.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTACH_FILE,
  claimOf,
  type Ingested,
  type IngestHandler,
  type IngestMatch,
  provideIngest,
} from "./ingest";
import { setToastSink } from "./toast";

const pasted = (text: string): Ingested => ({
  gesture: "paste",
  types: ["text/plain"],
  text,
  files: [],
});
const file = new File(["x"], "photo.png", { type: "image/png" });
const dropped: Ingested = { gesture: "drop", types: ["Files"], text: "", files: [file] };

/** A handler that makes a tree of its own name, or declines when `declines`. */
function handler(name: string, match: IngestMatch, priority = 0, declines = false): IngestHandler {
  return { match, priority, ingest: () => (declines ? null : { tree: name }) };
}
const lines = handler("lines", { gestures: ["paste"], types: ["text/plain"], pattern: "\\n" });
const urls = handler(
  "urls",
  { gestures: ["paste"], types: ["text/plain"], pattern: "^https?://" },
  5,
);
const words = handler("words", { gestures: ["paste"], types: ["text/plain"] });
const site = { nodeId: "n", text: "" };
/** What claims `ingested` among `handlers`: the tree the claim makes, or null when none does. */
function claimed(handlers: readonly IngestHandler[], ingested: Ingested) {
  const claim = claimOf(handlers, ingested, site);
  if (claim === null) return null;
  return "tree" in claim.outcome ? claim.outcome.tree : claim.outcome.attach;
}

describe("who claims a paste or a drop", () => {
  const told: string[] = [];
  beforeEach(() => {
    told.length = 0;
    setToastSink((message) => told.push(message));
  });

  it("is the first whose match holds and that makes something, by priority, then as listed", () => {
    expect(claimed([lines, urls, words], pasted("https://kb.example"))).toBe("urls");
    expect(claimed([lines, urls, words], pasted("a\nb"))).toBe("lines");
    expect(claimed([words, lines], pasted("a\nb"))).toBe("words");
  });

  it("asks the next when one before it makes nothing", () => {
    const declining = handler("declining", { gestures: ["paste"], types: ["text/plain"] }, 9, true);
    expect(claimed([words, declining], pasted("a"))).toBe("words");
  });

  it("is no one when every handler makes nothing, so the browser's own runs", () => {
    const declining = handler("declining", { gestures: ["paste"], types: ["text/plain"] }, 9, true);
    expect(claimOf([declining], pasted("a"), site)).toBeNull();
    expect(claimOf([ATTACH_FILE], { ...dropped, files: [] }, site)).toBeNull();
  });

  it("skips one that throws, and tells the person", () => {
    const throwing: IngestHandler = {
      match: { gestures: ["paste"], types: ["text/plain"] },
      priority: 9,
      ingest: () => {
        throw new Error("no");
      },
    };
    expect(claimed([throwing, words], pasted("a"))).toBe("words");
    expect(told).toEqual(["A paste handler failed and was skipped: no"]);
  });

  it("takes only its gestures and its data's types", () => {
    expect(claimed([lines, urls, words], dropped)).toBeNull();
    expect(claimed([ATTACH_FILE], pasted("a"))).toBeNull();
    expect(claimed([ATTACH_FILE], dropped)).toBe(file);
  });

  it("takes nothing by a pattern that is no regular expression", () => {
    const broken = handler("broken", { gestures: ["paste"], types: ["text/plain"], pattern: "(" });
    expect(claimed([broken], pasted("("))).toBeNull();
  });
});

describe("a handler written as a transform", () => {
  const form = {
    match: { gestures: ["paste"], types: ["text/plain"], pattern: "^- " },
    priority: 10,
    transform: (text: string) => (text.includes("skip") ? null : text.toUpperCase()),
  } as const;

  it("makes the tree its transform returns, and declines for null", () => {
    const { id, value } = provideIngest("shout", form);
    expect(id).toBe("shout");
    expect(value.match).toBe(form.match);
    expect(value.priority).toBe(10);
    expect(value.ingest(pasted("- a"), site)).toEqual({ tree: "- A" });
    expect(value.ingest(pasted("- skip"), site)).toBeNull();
  });

  it("throws where its plugin applies when its pattern is no regular expression", () => {
    expect(() =>
      provideIngest("broken", { ...form, match: { ...form.match, pattern: "(" } }),
    ).toThrow(/paste handler broken: its pattern is no regular expression/);
  });
});
