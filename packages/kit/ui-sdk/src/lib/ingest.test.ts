/**
 * Paste and drop (DESIGN-UI.md → Paste and drop): the first handler whose
 * match holds, by priority, claims a gesture.
 */
import { describe, expect, it } from "vitest";
import {
  ATTACH_FILE,
  claimantOf,
  type Ingested,
  type IngestHandler,
  type IngestMatch,
  provideIngest,
} from "./ingest";

const pasted = (text: string): Ingested => ({
  gesture: "paste",
  types: ["text/plain"],
  text,
  files: [],
});
const file = new File(["x"], "photo.png", { type: "image/png" });
const dropped: Ingested = { gesture: "drop", types: ["Files"], text: "", files: [file] };

function handler(name: string, match: IngestMatch, priority = 0): IngestHandler & { name: string } {
  return { name, match, priority, ingest: () => Promise.resolve(null) };
}
const lines = handler("lines", { gestures: ["paste"], types: ["text/plain"], pattern: "\\n" });
const urls = handler(
  "urls",
  { gestures: ["paste"], types: ["text/plain"], pattern: "^https?://" },
  5,
);
const words = handler("words", { gestures: ["paste"], types: ["text/plain"] });
const nameOf = (claimant: IngestHandler | null) =>
  (claimant as (IngestHandler & { name: string }) | null)?.name ?? null;

describe("who claims a paste or a drop", () => {
  it("is the first whose match holds, by priority, then as listed", () => {
    expect(nameOf(claimantOf([lines, urls, words], pasted("https://kb.example")))).toBe("urls");
    expect(nameOf(claimantOf([lines, urls, words], pasted("a\nb")))).toBe("lines");
    expect(nameOf(claimantOf([words, lines], pasted("a\nb")))).toBe("words");
  });

  it("takes only its gestures and its data's types", () => {
    expect(claimantOf([lines, urls, words], dropped)).toBeNull();
    expect(claimantOf([ATTACH_FILE], pasted("a"))).toBe(null);
    expect(claimantOf([ATTACH_FILE], dropped)).toBe(ATTACH_FILE);
  });

  it("takes nothing by a pattern that is no regular expression", () => {
    const broken = handler("broken", { gestures: ["paste"], types: ["text/plain"], pattern: "(" });
    expect(claimantOf([broken], pasted("("))).toBeNull();
  });
});

describe("a handler written as a transform", () => {
  const form = {
    match: { gestures: ["paste"], types: ["text/plain"], pattern: "^- " },
    priority: 10,
    transform: (text: string) => (text.includes("skip") ? null : text.toUpperCase()),
  } as const;

  it("makes the outline its transform returns, or nothing for null", async () => {
    const { id, value } = provideIngest("shout", form);
    expect(id).toBe("shout");
    expect(value.match).toBe(form.match);
    expect(value.priority).toBe(10);
    const site = { nodeId: "n", text: "" };
    await expect(value.ingest(pasted("- a"), site)).resolves.toEqual({ outline: "- A" });
    await expect(value.ingest(pasted("- skip"), site)).resolves.toBeNull();
  });

  it("throws where its plugin applies when its pattern is no regular expression", () => {
    expect(() =>
      provideIngest("broken", { ...form, match: { ...form.match, pattern: "(" } }),
    ).toThrow(/paste handler broken: its pattern is no regular expression/);
  });
});
