/**
 * Scene, drawn as the composer draws it: the field takes a style by `#`,
 * each part shows what fills it or "Auto", a part's picker toggles styles
 * and stays open, and References pins the library's visuals. Everything it
 * changes is the one look's draft, which every workflow shares.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { EMPTY_LOOK, GALLERY_IDS, libraryOf, type GraphNode } from "@kb/gallery";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { currentDraft, updateDraft } from "../draft";
import { ComposerFrameContext, type ComposerFrame } from "../frame";
import { SceneSurface } from "./scene";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (
  id: string,
  tag: string | null,
  children: string[] = [],
  text = id,
  styles: string[] = [],
): GraphNode => ({
  id,
  text,
  props: {
    ...(tag === null ? {} : { [SYSTEM_IDS.typeField]: [ref(tag)] }),
    ...(styles.length === 0 ? {} : { [GALLERY_IDS.stylesField]: styles.map(ref) }),
  },
  children,
});
const NODES = [
  n("styles", null, ["lighting", "angle"]),
  n("lighting", GALLERY_IDS.facetTag, ["s.golden", "s.noir"], "Lighting"),
  n("s.golden", GALLERY_IDS.styleTag, [], "golden hour"),
  n("s.noir", GALLERY_IDS.styleTag, [], "film noir lighting"),
  n("angle", GALLERY_IDS.facetTag, ["s.low"], "Camera angle"),
  n("s.low", GALLERY_IDS.styleTag, [], "low angle"),
  n("library", null, ["v.pagoda", "v.street"]),
  n("v.pagoda", GALLERY_IDS.visualTag, [], "One Pillar Pagoda", ["s.golden"]),
  n("v.street", GALLERY_IDS.visualTag, [], "Night street", ["s.noir"]),
];
const byId = new Map(NODES.map((node) => [node.id, node]));
const FRAME: ComposerFrame = {
  library: libraryOf(NODES),
  node: (id) => byId.get(id),
  sources: [],
  saveInto: null,
  model: null,
  board: null,
  open: () => {},
};

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const part = (label: string) => q(`[data-gallery-part="${label}"]`);
const click = (el: HTMLElement | null) => act(() => el?.click());

let dom: InstalledDom;

/** Type `text` into the scene's field as a person does: the caret ends where they stopped. */
function type(text: string): void {
  const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="The scene"]');
  if (field === null) throw new Error("no field");
  act(() => {
    field.focus();
    // Through the prototype's setter, as typing does, so React sees a change.
    Reflect.set(Object.getPrototypeOf(field) as object, "value", text, field);
    // React DOM loaded before this window, so it hears the change on the key's release.
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
    field.dispatchEvent(
      new dom.window.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event,
    );
  });
}

describe("Scene", () => {
  let root: Root;
  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    updateDraft(() => EMPTY_LOOK);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() =>
      root.render(
        <ComposerFrameContext.Provider value={FRAME}>
          <SceneSurface params={{}} />
        </ComposerFrameContext.Provider>,
      ),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  test("has a part per axis the library fills, each Auto until something fills it", () => {
    expect(part("Lighting")?.textContent).toContain("Auto");
    expect(part("Composition")?.textContent).toContain("Auto");
    expect(part("References")?.textContent).toContain("None");
  });

  test("takes a style typed after # into the look, leaving the words around it", () => {
    type("a pagoda at dawn, #gold");
    const suggestion = q('[data-gallery-suggestion="golden hour"]');
    expect(suggestion?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      q('textarea[aria-label="The scene"]')?.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }) as unknown as Event,
      );
    });
    expect(currentDraft().styles).toEqual(["s.golden"]);
    expect(currentDraft().description).toBe("a pagoda at dawn, ");
    expect(part("Lighting")?.textContent).toContain("golden hour");
  });

  test("opens a part's styles as picture cards, which toggle and leave it open", () => {
    click(part("Lighting"));
    const sheet = q('[role="dialog"][aria-label="Choose Lighting"]');
    expect(sheet).not.toBeNull();
    click(q('[data-gallery-style="film noir lighting"]'));
    click(q('[data-gallery-style="golden hour"]'));
    expect(currentDraft().styles).toEqual(["s.noir", "s.golden"]);
    expect(q('[data-gallery-style="golden hour"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(q('[role="dialog"]')).not.toBeNull();
    click(q('[data-gallery-style="golden hour"]'));
    expect(currentDraft().styles).toEqual(["s.noir"]);
    expect(q("[data-gallery-new-style]")?.textContent).toContain("Lighting");
    click(
      [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Done") ??
        null,
    );
    expect(q('[role="dialog"]')).toBeNull();
    expect(part("Lighting")?.textContent).toContain("film noir lighting");
  });

  test("pins references, the most like the pinned ones first", () => {
    click(part("References"));
    click(q('[data-gallery-reference="Night street"]'));
    expect(currentDraft().pins.map((p) => p.visual)).toEqual(["v.street"]);
    const offered = [...document.querySelectorAll("[data-gallery-reference]")].map((el) =>
      el.getAttribute("data-gallery-reference"),
    );
    expect(offered[0]).toBe("Night street");
    click(q('[data-gallery-reference="Night street"]'));
    expect(currentDraft().pins).toEqual([]);
  });
});
