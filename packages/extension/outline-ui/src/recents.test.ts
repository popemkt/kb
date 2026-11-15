/**
 * Recent is screen state (DESIGN-UI.md → Node-scoped commands): newest
 * first, ten at most, ids the graph no longer holds dropped at the next
 * visit, kept by this browser in `localStorage`, whichever tab wrote it.
 */
import { Window } from "happy-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_LIMIT, RECENT_STORAGE_KEY, recordRecent } from "./recents";

let dom: Window;
beforeAll(() => {
  dom = new Window();
  (globalThis as Record<string, unknown>).localStorage = dom.localStorage;
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});
beforeEach(() => {
  dom.localStorage.clear();
});

const stored = (): unknown => JSON.parse(dom.localStorage.getItem(RECENT_STORAGE_KEY) ?? "null");
const everything = () => true;

describe("Recent", () => {
  it("puts the node visited first, moving one visited before", () => {
    recordRecent("a", everything);
    recordRecent("b", everything);
    recordRecent("a", everything);
    expect(stored()).toEqual(["a", "b"]);
  });

  it(`keeps the ${RECENT_LIMIT} newest`, () => {
    for (let i = 0; i <= RECENT_LIMIT; i += 1) recordRecent(`n${i}`, everything);
    const kept = stored() as string[];
    expect(kept).toHaveLength(RECENT_LIMIT);
    expect(kept[0]).toBe(`n${RECENT_LIMIT}`);
    expect(kept).not.toContain("n0");
  });

  it("drops the ids the graph no longer holds at the next visit", () => {
    recordRecent("gone", everything);
    recordRecent("kept", everything);
    recordRecent("new", (id) => id !== "gone");
    expect(stored()).toEqual(["new", "kept"]);
  });

  it("writes nothing when the node visited is already first", () => {
    recordRecent("a", everything);
    const setItem = vi.spyOn(dom.localStorage, "setItem");
    recordRecent("a", everything);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("reads what storage holds, so another tab's visits are kept", () => {
    dom.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(["x", "y"]));
    recordRecent("z", everything);
    expect(stored()).toEqual(["z", "x", "y"]);
  });
});
