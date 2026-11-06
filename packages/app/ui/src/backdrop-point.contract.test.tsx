/**
 * The page-head backdrop contract (DESIGN-UI.md → Page-head backdrops):
 * every backdrop contributed to `BackdropPoint`, the page's families' and a
 * plugin's own, is declared, so the seed holds its option under
 * `sys.f.backdrop`, the one list Settings picks from; it is shown by the
 * one slot (`PageBackdrop`) for every strength and direction core's
 * settings choose, framed by its own presentation; Settings draws it as a
 * card, its own renderer held still, and choosing that card writes core's
 * setting, which the slot then shows. A page's own node chooses for that
 * page over core's.
 *
 * A backdrop no declaration lists, or one the slot passes over, or one only
 * kb's own family could contribute, fails here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import {
  NO_SWITCHES,
  declarationPlugin,
  defineExtension,
  familyOn,
  type WireNode,
} from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  BACKDROP_DIRECTIONS,
  BACKDROP_DIRECTION_OPTION_IDS,
  BACKDROP_STRENGTHS,
  BACKDROP_STRENGTH_OPTION_IDS,
  BACKDROP_VARIANT_OPTIONS,
  SYSTEM_IDS,
  backdropOptionId,
  backdropVariantOptions,
  declaredOptionId,
  extensionNodeId,
  foldSeed,
  backdropVariantOptionId,
  knobFieldId,
  knobSchemaError,
  knobsOf,
  type Knob,
  type BackdropDirection,
  type BackdropStrength,
  type KbNode,
  type PropValue,
  type SeedBackdrop,
} from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  BREAKOUT_CLASS,
  BackdropPoint,
  EMPTY_EDITOR,
  PageBackdrop,
  currentContributions,
  provideBackdrop,
  syncUiPlugins,
  useReducedMotion,
  type BackdropProps,
  type OutlineNode,
  type PageEditor,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { BackdropPreview } from "@/backdrop-preview";
import { designSystemsUiPlugin } from "@/design-systems";
import { SettingsPage } from "@/components/prefs/settings-page";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import { useGraphStore } from "@/stores/graph.store";
import { providePageEditor } from "@/stores/page-editor";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { BROWSER_EXTENSIONS } from "@/ui-plugins";

const AT = "2026-01-01T00:00:00.000Z";
const CORE = extensionNodeId("core");

/** A plugin's own backdrop: it shows what it was handed, so the slot's props can be read back. */
function PlainBackdrop({
  color,
  strength,
  direction,
  opacity,
  activity,
  pointer,
  variant,
  knobs,
  budget,
}: BackdropProps) {
  const place = pointer.now();
  const still = useReducedMotion();
  return (
    <i
      data-plain={`${color} ${strength} ${direction} ${opacity}`}
      data-variant={variant ?? "none"}
      data-knobs={JSON.stringify(knobs)}
      data-budget={budget.frameMs}
      data-still={String(still)}
      data-editing={String(activity.editing)}
      data-writes={activity.writes}
      data-pointer={place === null ? "none" : `${place.x},${place.y}`}
      ref={(element) => {
        if (element !== null) pointerNow = pointer.now;
      }}
    />
  );
}
/** The last pointer source the plain backdrop was handed: polled by the test, as a backdrop polls it. */
let pointerNow: () => { x: number; y: number } | null = () => null;
/**
 * Two variants: one at the backdrop's own default strength, one that
 * declares its own; a knob of the backdrop's, and one only the loud variant
 * has.
 */
const PLAIN_KEY: SeedBackdrop = {
  id: "plain.plain",
  label: "Plain",
  credit: "The test's own",
  strength: "soft",
  knobs: [{ kind: "number", id: "size", label: "Size", min: 0, max: 4, step: 0.5, default: 2 }],
  variants: [
    { id: "calm", label: "Calm" },
    {
      id: "loud",
      label: "Loud",
      strength: "vivid",
      knobs: [{ kind: "boolean", id: "shout", label: "Shout", default: true }],
    },
  ],
};
/** The page-head frame budget no backdrop may exceed (DESIGN-UI.md → GPU scenes → Cost). */
const PAGE_HEAD_FRAME_MS = 6;
const PLAIN_OPACITY = { subtle: 0.1, soft: 0.2, vivid: 0.3 };
/** A family of the test's own: it declares its backdrop, and its page plugin contributes it. */
const plainExtension = defineExtension({
  name: "plain",
  label: "Plain",
  declaredOptions: [
    { kind: BACKDROP_OPTIONS, options: [PLAIN_KEY] },
    { kind: BACKDROP_VARIANT_OPTIONS, options: backdropVariantOptions([PLAIN_KEY]) },
  ],
});
const plainPlugin = definePlugin({
  name: "plain",
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(declarationPlugin(plainExtension)),
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(PLAIN_KEY, {
            presentation: {
              space: 40,
              directions: BACKDROP_DIRECTIONS,
              height: 120,
              span: { reach: "content", maxWidth: 600 },
              offset: 0,
              opacity: PLAIN_OPACITY,
            },
            budget: { frameMs: 1 },
            Component: PlainBackdrop,
          }),
        ),
      ],
      { discard: true },
    ),
});

/** The browser entries of the families on in a store with no switch written, as the page loads them. */
const PAGE_FAMILIES = await Promise.all(
  BUNDLED_FAMILIES.filter((declaration) => familyOn(declaration, NO_SWITCHES, () => {})).flatMap(
    (declaration) => BROWSER_EXTENSIONS[declaration.name]?.load() ?? [],
  ),
);

/** The seed of the bundled families and the test's own. */
const SEED = foldSeed([...BUNDLED_DECLARATIONS, plainExtension], AT).nodes;

/** That seed, with core's node holding `settings`. */
function graphWith(settings: KbNode["props"]): WireNode[] {
  return SEED.map((node) =>
    node.id === CORE ? { ...node, props: { ...node.props, ...settings } } : node,
  );
}

/** The backdrop field's value that chooses the declared backdrop `id`. */
const choosing = (id: string): PropValue => ({ t: "ref", v: backdropOptionId(id) });

function settingsOf(
  backdrop: string,
  strength: BackdropStrength,
  direction: BackdropDirection,
): KbNode["props"] {
  return {
    [SYSTEM_IDS.backdropField]: [choosing(backdrop)],
    [SYSTEM_IDS.backdropStrengthField]: [{ t: "ref", v: BACKDROP_STRENGTH_OPTION_IDS[strength] }],
    [SYSTEM_IDS.backdropDirectionField]: [
      { t: "ref", v: BACKDROP_DIRECTION_OPTION_IDS[direction] },
    ],
  };
}

/** Wait, inside act, until `landed` holds (a lazy chunk has loaded), for at most a second. */
async function settle(landed: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !landed(); tries += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
}

/** Every backdrop the page's kernel holds now. */
const backdrops = () => currentContributions(BackdropPoint);

/** The slot's frame as rendered for `node`'s page (none: the outline's home). */
function slot(node?: OutlineNode): HTMLElement | null {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(PageBackdrop, { color: "red", ...(node === undefined ? {} : { node }) }),
  );
  return host.querySelector<HTMLElement>(".kb-header-backdrop");
}

describe("every contributed page-head backdrop", () => {
  let installed: InstalledDom;

  beforeAll(() => {
    installed = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    // Core's previews come with the page: the backdrop field's card is one.
    syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES, plainPlugin]);
  });
  afterAll(() => {
    syncUiPlugins([]);
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    installed.restore();
  });

  it("counts the page's families' backdrops and a plugin's own", () => {
    const ids = backdrops().map(({ value }) => value.key.id);
    expect(ids).toContain(PLAIN_KEY.id);
    expect(ids.length).toBeGreaterThan(1);
  });

  it("answers to its declared id, and the seed holds its option, labelled, under the backdrop field", () => {
    const field = SEED.find((node) => node.id === SYSTEM_IDS.backdropField);
    for (const { id, value } of backdrops()) {
      expect(id).toBe(value.key.id);
      const option = SEED.find((node) => node.id === backdropOptionId(value.key.id));
      expect(option?.text, value.key.id).toBe(value.key.label);
      expect(field?.children).toContain(option?.id);
    }
  });

  it("is shown by the slot, framed by its presentation, for each strength and direction", () => {
    for (const { value } of backdrops()) {
      for (const strength of BACKDROP_STRENGTHS) {
        for (const direction of BACKDROP_DIRECTIONS) {
          useGraphStore
            .getState()
            .hydrateFromWire(
              graphWith(settingsOf(value.key.id, strength, direction)),
              1,
              "fixtures",
            );
          const frame = slot();
          expect(frame?.dataset.backdrop, `${value.key.id} ${strength} ${direction}`).toBe(
            value.key.id,
          );
          expect(frame?.dataset.direction).toBe(direction);
          expect(frame?.style.height).toBe(`${value.presentation.height}px`);
          const { span } = value.presentation;
          // Bounded under the content, or across the scroll region as a breakout.
          expect({
            maxWidth: frame?.style.maxWidth,
            breakout: frame?.classList.contains(BREAKOUT_CLASS),
          }).toEqual(
            span.reach === "content"
              ? { maxWidth: `${span.maxWidth}px`, breakout: false }
              : { maxWidth: "", breakout: true },
          );
        }
      }
    }
  });

  it("draws in its frame once it has loaded, a lazy backdrop too", async () => {
    // A lazy backdrop shows nothing until its module has loaded (a placeholder would be
    // a second appearance), so its frame is read from a render that waits for it.
    for (const { value } of backdrops()) {
      useGraphStore
        .getState()
        .hydrateFromWire(graphWith(settingsOf(value.key.id, "soft", "down")), 1, "fixtures");
      const { prelude } = await prerender(createElement(PageBackdrop, { color: "red" }));
      const host = document.createElement("div");
      host.innerHTML = await new Response(prelude).text();
      const frame = host.querySelector<HTMLElement>(".kb-header-backdrop");
      expect(frame?.childElementCount, value.key.id).toBeGreaterThan(0);
    }
  });

  it("hands its component the colour, the strength, the direction and that strength's opacity", () => {
    for (const strength of BACKDROP_STRENGTHS) {
      useGraphStore
        .getState()
        .hydrateFromWire(graphWith(settingsOf(PLAIN_KEY.id, strength, "up")), 1, "fixtures");
      expect(slot()?.querySelector("[data-plain]")?.getAttribute("data-plain")).toBe(
        `red ${strength} up ${PLAIN_OPACITY[strength]}`,
      );
    }
  });

  it("with no strength chosen, hands its component the drawn variant's own, and a chosen one over it", () => {
    const pinning = (variant: string): KbNode["props"] => ({
      [SYSTEM_IDS.backdropField]: [choosing(PLAIN_KEY.id)],
      [SYSTEM_IDS.backdropVariantField]: [
        { t: "ref", v: declaredOptionId(BACKDROP_VARIANT_OPTIONS, `${PLAIN_KEY.id}.${variant}`) },
      ],
    });
    const shown = () => {
      const plain = slot()?.querySelector("[data-plain]");
      return `${plain?.getAttribute("data-variant")}: ${plain?.getAttribute("data-plain")}`;
    };
    useGraphStore.getState().hydrateFromWire(graphWith(pinning("loud")), 1, "fixtures");
    expect(shown()).toBe(`loud: red vivid down ${PLAIN_OPACITY.vivid}`);
    useGraphStore.getState().hydrateFromWire(graphWith(pinning("calm")), 1, "fixtures");
    // Calm declares no strength of its own, so it shows at its backdrop's.
    expect(shown()).toBe(`calm: red soft down ${PLAIN_OPACITY.soft}`);
    useGraphStore.getState().hydrateFromWire(
      graphWith({
        ...pinning("loud"),
        [SYSTEM_IDS.backdropStrengthField]: [{ t: "ref", v: BACKDROP_STRENGTH_OPTION_IDS.soft }],
      }),
      1,
      "fixtures",
    );
    expect(shown()).toBe(`loud: red soft down ${PLAIN_OPACITY.soft}`);
  });

  it("declares a well-formed knob schema, its variants' too, and a budget within the page head's", () => {
    for (const { value } of backdrops()) {
      const { key, budget } = value;
      for (const variant of [null, ...(key.variants ?? []).map(({ id }) => id)]) {
        expect(knobSchemaError(knobsOf(key, variant)), `${key.id} ${variant}`).toBeNull();
      }
      expect(budget.frameMs, key.id).toBeGreaterThan(0);
      expect(budget.frameMs, key.id).toBeLessThanOrEqual(PAGE_HEAD_FRAME_MS);
    }
  });

  it("hands its component its budget and its knobs' defaults, the drawn variant's with them", () => {
    const pinning = (variant: string): KbNode["props"] => ({
      [SYSTEM_IDS.backdropField]: [choosing(PLAIN_KEY.id)],
      [SYSTEM_IDS.backdropVariantField]: [
        { t: "ref", v: declaredOptionId(BACKDROP_VARIANT_OPTIONS, `${PLAIN_KEY.id}.${variant}`) },
      ],
    });
    const plain = () => slot()?.querySelector("[data-plain]");
    useGraphStore.getState().hydrateFromWire(graphWith(pinning("loud")), 1, "fixtures");
    expect(JSON.parse(plain()?.getAttribute("data-knobs") ?? "null")).toEqual({
      size: 2,
      shout: true,
    });
    expect(plain()?.getAttribute("data-budget")).toBe("1");
    useGraphStore.getState().hydrateFromWire(graphWith(pinning("calm")), 1, "fixtures");
    expect(JSON.parse(plain()?.getAttribute("data-knobs") ?? "null")).toEqual({ size: 2 });
  });

  it("hands its component the knob values its node holds, held to their range, the variant's from the variant's node", () => {
    const backdropNode = backdropOptionId(PLAIN_KEY.id);
    const variantNode = backdropVariantOptionId(PLAIN_KEY.id, "loud");
    const holding = (values: Record<string, KbNode["props"]>): WireNode[] =>
      graphWith({
        [SYSTEM_IDS.backdropField]: [choosing(PLAIN_KEY.id)],
        [SYSTEM_IDS.backdropVariantField]: [{ t: "ref", v: variantNode }],
      }).map((node) => {
        const props = values[node.id];
        return props === undefined ? node : { ...node, props: { ...node.props, ...props } };
      });
    const knobs = () =>
      JSON.parse(slot()?.querySelector("[data-plain]")?.getAttribute("data-knobs") ?? "null");
    useGraphStore.getState().hydrateFromWire(
      holding({
        [backdropNode]: { [knobFieldId(backdropNode, "size")]: [{ t: "num", v: 3.5 }] },
        [variantNode]: { [knobFieldId(variantNode, "shout")]: [{ t: "bool", v: false }] },
      }),
      1,
      "fixtures",
    );
    expect(knobs()).toEqual({ size: 3.5, shout: false });
    useGraphStore
      .getState()
      .hydrateFromWire(
        holding({ [backdropNode]: { [knobFieldId(backdropNode, "size")]: [{ t: "num", v: 40 }] } }),
        1,
        "fixtures",
      );
    expect(knobs()).toEqual({ size: 4, shout: true });
  });

  it("has one field per knob in the seed, configuring the node its values sit on", () => {
    for (const { value } of backdrops()) {
      const { key } = value;
      const holders: [string, readonly Knob[]][] = [
        [backdropOptionId(key.id), key.knobs ?? []],
        ...(key.variants ?? []).map((variant): [string, readonly Knob[]] => [
          backdropVariantOptionId(key.id, variant.id),
          variant.knobs ?? [],
        ]),
      ];
      for (const [holder, knobs] of holders) {
        for (const knob of knobs) {
          const field = SEED.find((node) => node.id === knobFieldId(holder, knob.id));
          expect(field, `${key.id} ${knob.id}`).toBeDefined();
          expect(field?.props[SYSTEM_IDS.configuresField]).toEqual([{ t: "ref", v: holder }]);
        }
      }
    }
  });

  it("hands its component what the owner is doing: no editing, and the writes the graph has taken", () => {
    useGraphStore
      .getState()
      .hydrateFromWire(graphWith(settingsOf(PLAIN_KEY.id, "soft", "down")), 1, "fixtures");
    const shown = slot()?.querySelector("[data-plain]");
    expect(shown?.getAttribute("data-editing")).toBe("false");
    expect(Number(shown?.getAttribute("data-writes"))).toBe(
      useGraphStore.getState().index?.generation ?? 0,
    );
  });

  it("with nothing chosen, the first contributed, subtle and facing down", () => {
    useGraphStore.getState().hydrateFromWire(graphWith({}), 1, "fixtures");
    const frame = slot();
    expect(frame?.dataset.backdrop).toBe(backdrops()[0]?.value.key.id);
    expect(frame?.dataset.direction).toBe("down");
  });

  it("a page's own node chooses for that page over core's", () => {
    const other = backdrops().find(({ value }) => value.key.id !== PLAIN_KEY.id)?.value.key.id;
    if (other === undefined) throw new Error("no family contributes a backdrop");
    useGraphStore
      .getState()
      .hydrateFromWire(graphWith(settingsOf(other, "vivid", "down")), 1, "fixtures");
    const own: OutlineNode = {
      id: "n.page",
      text: "A page",
      parentId: null,
      children: [],
      collapsed: false,
      props: { [SYSTEM_IDS.backdropField]: [choosing(PLAIN_KEY.id)] },
      createdAt: AT,
      updatedAt: AT,
      tags: [],
    };
    expect(slot()?.dataset.backdrop).toBe(other);
    expect(slot(own)?.dataset.backdrop).toBe(PLAIN_KEY.id);
    // The settings the page leaves unsaid are core's.
    expect(slot(own)?.querySelector("[data-plain]")?.getAttribute("data-plain")).toBe(
      `red vivid down ${PLAIN_OPACITY.vivid}`,
    );
  });

  it("a page's stale choice, a backdrop nobody contributes, falls through to core's", () => {
    // Core's choice is not the first contributed, so falling through differs from defaulting.
    expect(backdrops()[0]?.value.key.id).not.toBe(PLAIN_KEY.id);
    useGraphStore
      .getState()
      .hydrateFromWire(graphWith(settingsOf(PLAIN_KEY.id, "vivid", "down")), 1, "fixtures");
    const stale: OutlineNode = {
      id: "n.page",
      text: "A page",
      parentId: null,
      children: [],
      collapsed: false,
      props: { [SYSTEM_IDS.backdropField]: [choosing("backdrops.gone")] },
      createdAt: AT,
      updatedAt: AT,
      tags: [],
    };
    expect(slot(stale)?.dataset.backdrop).toBe(PLAIN_KEY.id);
  });

  describe("as the owner works", () => {
    let container: HTMLElement;
    let root: Root;

    beforeAll(() => {
      useGraphStore
        .getState()
        .hydrateFromWire(graphWith(settingsOf(PLAIN_KEY.id, "soft", "down")), 1, "fixtures");
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root.render(createElement(PageBackdrop, { color: "red" })));
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
    });

    const shown = () => container.querySelector("[data-plain]");
    const writes = () => Number(shown()?.getAttribute("data-writes"));

    it("is told where the pointer is over its own frame, and when it is not", () => {
      const frame = container.querySelector<HTMLElement>(".kb-header-backdrop");
      if (frame === null) throw new Error("the slot drew no frame");
      // The frame has no layout in a test DOM: give it a box. The slot listens on what covers it.
      frame.getBoundingClientRect = () =>
        ({ left: 100, top: 40, width: 300, height: 120, right: 400, bottom: 160 }) as DOMRect;
      const head = frame.parentElement;
      if (head === null) throw new Error("the frame has no head around it");
      const move = (x: number, y: number) =>
        act(() => {
          head.dispatchEvent(new window.MouseEvent("pointermove", { clientX: x, clientY: y }));
        });
      expect(pointerNow()).toBeNull();
      move(130, 70);
      expect(pointerNow()).toEqual({ x: 30, y: 30 });
      move(600, 70);
      expect(pointerNow()).toBeNull();
      move(130, 70);
      act(() => {
        head.dispatchEvent(new window.MouseEvent("pointerleave"));
      });
      expect(pointerNow()).toBeNull();
    });

    it("sees a node's text being edited, and then not", () => {
      const idle = EMPTY_EDITOR.getState();
      const editor = (activeNodeId: string | null): PageEditor => ({
        getState: () => ({ ...idle, activeNodeId }),
        subscribe: () => () => undefined,
      });
      act(() => providePageEditor(editor("n.page")));
      expect(shown()?.getAttribute("data-editing")).toBe("true");
      act(() => providePageEditor(editor(null)));
      expect(shown()?.getAttribute("data-editing")).toBe("false");
      act(() => providePageEditor(EMPTY_EDITOR));
    });

    it("sees each write land as the writes count rising", async () => {
      const before = writes();
      await act(() =>
        mutations.updateProp(CORE, SYSTEM_IDS.backdropStrengthField, {
          t: "ref",
          v: BACKDROP_STRENGTH_OPTION_IDS.vivid,
        }),
      );
      expect(writes()).toBeGreaterThan(before);
    });
  });

  describe("in Settings", () => {
    let container: HTMLElement;
    let root: Root;

    beforeAll(async () => {
      useGraphStore.getState().hydrateFromWire(graphWith({}), 1, "fixtures");
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root.render(createElement(SettingsPage, { part: "appearance" })));
      // The gallery and its cards load behind lazy(): wait, inside act, until the cards have landed.
      await settle(
        () =>
          container.querySelectorAll(
            `[data-setting="${SYSTEM_IDS.backdropField}"] [data-option-card]`,
          ).length > 0,
      );
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
    });

    const rows = () => {
      const group = container.querySelector('[data-settings-section="page-head"]');
      if (group === null) throw new Error("Settings draws no backdrop settings");
      return group;
    };

    /** The gallery's card for the declared backdrop `id`. */
    const card = (id: string) => {
      const found = rows().querySelector<HTMLElement>(
        `[role="radio"][data-option="${backdropOptionId(id)}"]`,
      );
      if (found === null) throw new Error(`the gallery draws no card for ${id}`);
      return found;
    };

    it("draws core's five settings as field rows, the backdrop's as a gallery with a card per contributed backdrop", () => {
      expect(rows().querySelectorAll("[data-field-row]")).toHaveLength(5);
      expect(rows().querySelector("[data-option-gallery]")).not.toBeNull();
      for (const { value } of backdrops()) {
        expect(
          card(value.key.id).querySelector(`[data-option-card="${value.key.id}"]`),
        ).not.toBeNull();
      }
    });

    it("draws a card's backdrop with its own renderer, still, at core's strength, hearing no owner", async () => {
      const Observer = globalThis.IntersectionObserver;
      // The card mounts its frame once it is on screen: here, at once.
      globalThis.IntersectionObserver = class {
        readonly seen: IntersectionObserverCallback;
        constructor(seen: IntersectionObserverCallback) {
          this.seen = seen;
        }
        observe(target: Element) {
          this.seen([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
        }
        disconnect() {}
        unobserve() {}
      } as unknown as typeof IntersectionObserver;
      const host = document.createElement("div");
      document.body.appendChild(host);
      const own = createRoot(host);
      try {
        act(() => own.render(createElement(BackdropPreview, { id: PLAIN_KEY.id, size: "card" })));
        await settle(() => host.querySelector("[data-plain]") !== null);
        const drawn = host.querySelector<HTMLElement>("[data-plain]");
        expect(drawn?.closest('[data-motion="reduced"]')).not.toBeNull();
        expect(drawn?.dataset.still).toBe("true");
        // Core chooses no strength here: the card shows the variant it drew at that variant's
        // own, and Calm, which declares none, at its backdrop's.
        const strength = drawn?.dataset.variant === "loud" ? "vivid" : "soft";
        expect(drawn?.dataset.plain).toBe(
          `var(--primary) ${strength} down ${PLAIN_OPACITY[strength]}`,
        );
        expect([drawn?.dataset.editing, drawn?.dataset.writes, drawn?.dataset.pointer]).toEqual([
          "false",
          "0",
          "none",
        ]);
        // The page head draws the same backdrop moving.
        await act(() =>
          mutations.updateProp(CORE, SYSTEM_IDS.backdropField, choosing(PLAIN_KEY.id)),
        );
        expect(slot()?.querySelector<HTMLElement>("[data-plain]")?.dataset.still).toBe("false");
      } finally {
        act(() => own.unmount());
        host.remove();
        globalThis.IntersectionObserver = Observer;
      }
    });

    it("is chosen by a card, which writes core's setting, and the row and the slot then show it", async () => {
      await act(() => mutations.updateProp(CORE, SYSTEM_IDS.backdropField, choosing(PLAIN_KEY.id)));
      const other = backdrops().find(({ value }) => value.key.id !== PLAIN_KEY.id)?.value.key;
      if (other === undefined) throw new Error("no second backdrop to choose");
      await act(async () => {
        card(other.id).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const core = useGraphStore.getState().index?.getNode(CORE);
      expect(core?.props[SYSTEM_IDS.backdropField]).toEqual([choosing(other.id)]);
      expect(card(other.id).getAttribute("aria-checked")).toBe("true");
      expect(slot()?.dataset.backdrop).toBe(other.id);
    });
  });
});
