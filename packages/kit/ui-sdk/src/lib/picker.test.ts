/**
 * The one node picker's contract (`lib/picker`): matching, ranking,
 * query-only filtering, and create rows. Every picker surface — value
 * pickers, text triggers, palette steps — meets this one contract.
 */
import { describe, expect, it } from "vitest";
import {
  CREATE_ROW_ID,
  matchCandidate,
  orderCandidates,
  pickerRows,
  type PickerCandidate,
} from "./picker";

const ids = (rows: ReturnType<typeof pickerRows>) => rows.map((r) => r.id);

describe("matchCandidate", () => {
  it("matches by label or id last segment, never sys.tag.* prefixes or ULIDs", () => {
    const tags: PickerCandidate[] = [
      { id: "sys.tag.calendar", label: "calendar" },
      { id: "ex.tag.task", label: "task" },
      { id: "sys.tag.status-option", label: "status-option" },
    ];
    expect(ids(pickerRows(tags, { query: "ta" }))).toEqual([
      "ex.tag.task",
      "sys.tag.status-option",
    ]);
    // A ULID id never matches, even on a two-character substring.
    expect(matchCandidate("Notes", "01KZFW1A5BT06QS7V6X6EBQMZ4", "kz")).toBeNull();
    // A single-character query never matches by id alone.
    expect(matchCandidate("Other", "n.alpha", "a")).toBeNull();
    // A dotted query like `sys.` still reaches system ids.
    expect(matchCandidate("calendar", "sys.tag.calendar", "sys.")?.score).toBe(2);
    expect(ids(pickerRows(tags, { query: "sys." }))).toEqual([
      "sys.tag.calendar",
      "sys.tag.status-option",
    ]);
    // The id's last segment still matches when query >= 2 chars.
    expect(matchCandidate("Other", "n.alpha", "al")?.score).toBe(2);
  });

  it("carries glyph and note through to item rows", () => {
    const rows = pickerRows([{ id: "ex.tag.task", label: "task", glyph: "#", note: "3 nodes" }], {
      query: "ta",
    });
    expect(rows).toEqual([
      {
        kind: "item",
        id: "ex.tag.task",
        label: "task",
        glyph: "#",
        note: "3 nodes",
        disabled: false,
        matches: [[0, 2]],
        selected: false,
      },
    ]);
  });

  it("requires three letters for fuzzy matches and keeps shorter literal matches", () => {
    expect(matchCandidate("Daily Updates", "n.report", "du")).toBeNull();
    expect(matchCandidate("Captured URL", "sys.f.capture.url", "du")).toBeNull();
    expect(matchCandidate("view.saved-query", "sys.f.view.saved-query", "du")).toBeNull();
    expect(matchCandidate("Daily User Updates", "n.report", "duu")?.score).toBe(3);
    expect(matchCandidate("due", "ex.f.due", "du")?.score).toBe(0);
    expect(matchCandidate("Sky · Stars and dust", "sys.backdrop.motes", "du")?.score).toBe(1);
  });
});

describe("orderCandidates with recents and uses", () => {
  const pool: PickerCandidate[] = [
    { id: "sys.tag.calendar", label: "calendar" },
    { id: "ex.tag.task", label: "task" },
    { id: "ex.tag.person", label: "person" },
    { id: "ex.tag.project", label: "project" },
  ];

  it.each(["Task", " Task "])("keeps the exact tag %j ahead of 12 more-used prefixes", (label) => {
    const prefixes = Array.from({ length: 12 }, (_, i) => ({
      id: `ex.tag.task-${i}`,
      label: `Task type ${i}`,
    }));
    const ordered = orderCandidates([...prefixes, { id: "ex.tag.task", label }], {
      uses: new Map(prefixes.map(({ id }) => [id, 10])),
      emptyQuery: "recent-or-used",
    });
    const rows = pickerRows(ordered, { query: " TASK ", limit: 12, canCreate: true });
    expect(ids(rows)).toEqual(["ex.tag.task", ...prefixes.slice(0, 11).map(({ id }) => id)]);
  });

  it("empty query returns recents first, then by use count, then (only matching) the rest", () => {
    const ordered = orderCandidates(pool, {
      recent: ["ex.tag.project"],
      uses: new Map([
        ["ex.tag.task", 5],
        ["ex.tag.person", 2],
      ]),
      emptyQuery: "recent-or-used",
    });
    expect(ids(pickerRows(ordered, { query: "" }))).toEqual([
      "ex.tag.project",
      "ex.tag.task",
      "ex.tag.person",
    ]);
    // The unused candidate still appears when the query matches its label.
    expect(ids(pickerRows(ordered, { query: "cal" }))).toEqual(["sys.tag.calendar"]);
  });

  it("requires a label match for an unused candidate with a renamed label", () => {
    const ordered = orderCandidates([{ id: "sys.tag.calendar", label: "Schedule" }], {
      emptyQuery: "recent-or-used",
    });
    expect(ids(pickerRows(ordered, { query: "cal" }))).toEqual([]);
    expect(ids(pickerRows(ordered, { query: "sched" }))).toEqual(["sys.tag.calendar"]);
    expect(ids(pickerRows(ordered, { query: "sys." }))).toEqual(["sys.tag.calendar"]);
  });

  it("keeps all options when a field declares their order", () => {
    const ordered = orderCandidates(pool, {
      declared: ["ex.tag.person", "ex.tag.task"],
      recent: ["ex.tag.project"],
      emptyQuery: "recent-or-used",
    });
    expect(ids(pickerRows(ordered, { query: "" }))).toEqual([
      "ex.tag.person",
      "ex.tag.task",
      "sys.tag.calendar",
      "ex.tag.project",
    ]);
  });

  it("does not offer to create a name that already belongs to a hidden candidate", () => {
    const ordered = orderCandidates(pool, { emptyQuery: "recent-or-used" });
    expect(ids(pickerRows(ordered, { query: "calendar", canCreate: true }))).toEqual([
      "sys.tag.calendar",
    ]);
    expect(ids(pickerRows(ordered, { query: "sprint", canCreate: true }))).toEqual([CREATE_ROW_ID]);
  });
});
