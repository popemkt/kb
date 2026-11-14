/**
 * A picker's keys (`usePickerKeys`): Enter picks the highlighted row, but
 * never a disabled one — the key is claimed, and nothing is picked, as a
 * click on it picks nothing. Alt+Enter picks it as the picker's alternate.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pickerRows, type PickerCandidate, type PickerRow } from "./picker";
import { usePickerKeys, type PickerKeys } from "./use-picker";

/** A picker over `candidates`, handing out the keys it answers. */
function Host({
  candidates,
  onPick,
  hold,
}: {
  candidates: readonly PickerCandidate[];
  onPick: (row: PickerRow | null, alternate: boolean) => void;
  hold: (keys: PickerKeys) => void;
}) {
  const rows = pickerRows(candidates, { query: "" });
  hold(usePickerKeys({ rows, query: "", onPick, onCancel: () => {} }));
  return null;
}

/** The keys a picker over `candidates` answers, as first drawn, and what they picked. */
function keysOver(candidates: readonly PickerCandidate[]) {
  const picked: Array<PickerRow | null> = [];
  const alternates: boolean[] = [];
  const held: { keys?: PickerKeys } = {};
  renderToStaticMarkup(
    createElement(Host, {
      candidates,
      onPick: (row, alternate) => {
        picked.push(row);
        alternates.push(alternate);
      },
      hold: (keys) => {
        held.keys = keys;
      },
    }),
  );
  const enter = (alt = false) =>
    held.keys?.handleKeyDown({ key: "Enter", altKey: alt, preventDefault: () => {} });
  return { picked, alternates, enter };
}

describe("a picker's Enter", () => {
  it("picks the highlighted row", () => {
    const { picked, enter } = keysOver([{ id: "a", label: "alpha" }]);
    expect(enter()).toBe(true);
    expect(picked.map((row) => row?.id)).toEqual(["a"]);
  });

  it("claims the key on a disabled row, and picks nothing", () => {
    const { picked, enter } = keysOver([{ id: "a", label: "alpha", disabled: true }]);
    expect(enter()).toBe(true);
    expect(picked).toEqual([]);
  });

  it("hands over no row when there is none", () => {
    const { picked, enter } = keysOver([]);
    expect(enter()).toBe(true);
    expect(picked).toEqual([null]);
  });

  it("picks it as the alternate with Alt", () => {
    const { picked, alternates, enter } = keysOver([{ id: "a", label: "alpha" }]);
    expect(enter(true)).toBe(true);
    expect(enter()).toBe(true);
    expect(picked.map((row) => row?.id)).toEqual(["a", "a"]);
    expect(alternates).toEqual([true, false]);
  });
});
