// @vitest-environment happy-dom
/**
 * Backdrop Studio (DESIGN-UI.md → Backdrop Studio), held to the page's
 * port: its gallery shows every backdrop contributed, whichever family
 * contributes it; one backdrop's page runs that scene alone, draws its
 * knobs and its variant's with labelled controls, and writes a value as a
 * setting on the node that holds it, through the page's writes, as one
 * write when a control is let go; a reset takes it out, or drops one not
 * yet let go; and "Use as my page
 * backdrop" writes core's backdrop setting, as Settings does.
 */
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  SYSTEM_IDS,
  backdropOptionId,
  backdropVariantOptionId,
  extensionNodeId,
  knobFieldId,
  type PropValue,
  type SeedBackdrop,
} from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  BACKDROP_BUDGETS,
  BackdropPoint,
  provideBackdrop,
  syncUiPlugins,
  type BackdropProps,
  type OutlineNode,
} from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin, type TestBrowserHost } from "@kb/ui-test-kit";
import StudioPage from "./studio-page";

const PROBE: SeedBackdrop = {
  id: "probe.hole",
  label: "Hole",
  credit: "After a probe",
  knobs: [
    { kind: "number", id: "mass", label: "Mass", min: 0, max: 2, step: 0.5, default: 1 },
    { kind: "boolean", id: "grain", label: "Grain", default: true },
  ],
  variants: [
    { id: "plain", label: "Plain" },
    {
      id: "warp",
      label: "Warp",
      knobs: [
        { kind: "number", id: "pull", label: "Pull", min: 0, max: 1, step: 0.25, default: 0.5 },
      ],
    },
  ],
};
const OTHER: SeedBackdrop = { id: "elsewhere.wash", label: "Wash" };

/** Every mount of a probe's scene, by its backdrop's id: the studio runs the one it shows. */
let mounts: string[] = [];

function probeScene(id: string) {
  return function ProbeScene({ knobs, variant }: BackdropProps) {
    if (!mounts.includes(id)) mounts.push(id);
    return <div data-probe={id} data-variant={variant ?? ""} data-knobs={JSON.stringify(knobs)} />;
  };
}

const presentation = {
  space: 100,
  directions: [],
  height: 200,
  span: { reach: "content", maxWidth: 900 },
  offset: 0,
  opacity: { subtle: 0.3, soft: 0.6, vivid: 0.9 },
} as const;

/** Two families' backdrops: the studio is every family's, not its own. */
const probes = definePlugin({
  name: "studio-probes",
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(PROBE, {
            presentation,
            budget: BACKDROP_BUDGETS.gpu,
            Component: probeScene(PROBE.id),
          }),
        ),
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(OTHER, {
            presentation,
            budget: BACKDROP_BUDGETS.dom,
            Component: probeScene(OTHER.id),
          }),
        ),
      ],
      { discard: true },
    ),
});

interface Written {
  readonly op: "set" | "unset";
  readonly node: string;
  readonly field: string;
  readonly value?: PropValue;
}

const HOLE = backdropOptionId(PROBE.id);
/** A pause longer than any a write might wait for. */
const pause = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)));

/** Move an input to `value` as a person's drag or typing does, so React hears the change. */
function enter(input: HTMLInputElement, value: string) {
  // Through the prototype's setter, as a person's input does, so React sees a change.
  Reflect.set(Object.getPrototypeOf(input) as object, "value", value, input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Let go of the input (a slider released, a field left): its value is settled, and the DOM says so with `change`. */
async function release(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function labelled(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll("label")].find((l) => l.textContent === text);
  const input = label === undefined ? null : document.getElementById(label.htmlFor);
  if (input?.tagName !== "INPUT") throw new Error(`no control labelled ${text}`);
  return input as HTMLInputElement;
}

const button = (name: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent.trim() === name,
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
};

const node = (id: string, props: OutlineNode["props"] = {}): OutlineNode =>
  ({ id, text: id, props, children: [] }) as unknown as OutlineNode;

describe("Backdrop Studio", () => {
  let root: Root;
  let host: TestBrowserHost;
  let written: Written[];

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  beforeEach(() => {
    mounts = [];
    written = [];
    const base = testBrowserHost();
    host = testBrowserHost({
      writes: {
        ...base.writes,
        updateProp: (id, field, value) => {
          written.push({ op: "set", node: id, field, value });
          return Promise.resolve();
        },
        removeProp: (id, field) => {
          written.push({ op: "unset", node: id, field });
          return Promise.resolve();
        },
      },
    });
    host.setNodes([node(HOLE), node(extensionNodeId("core"))]);
    syncUiPlugins([testHostPlugin(host), probes]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    syncUiPlugins([]);
  });

  test("the gallery shows every backdrop contributed, each opening its own scene", () => {
    act(() => root.render(<StudioPage />));
    const names = [...document.querySelectorAll("[data-studio-card]")].map((card) =>
      card.getAttribute("data-studio-card"),
    );
    expect(names).toEqual([PROBE.id, OTHER.id]);
    expect(document.body.textContent).toContain("After a probe");
  });

  test("one backdrop's page runs its scene alone", () => {
    act(() => root.render(<StudioPage backdrop={PROBE.id} />));
    expect(mounts).toEqual([PROBE.id]);
    expect(document.querySelectorAll("[data-probe]")).toHaveLength(1);
  });

  test("its knobs and its variant's are labelled controls; a drag is one write on its holder, made when it is let go", async () => {
    act(() => root.render(<StudioPage backdrop={PROBE.id} />));
    act(() => button("Warp").click());
    expect(document.querySelector("[data-probe]")?.getAttribute("data-variant")).toBe("warp");
    const mass = labelled("Mass");
    act(() => enter(mass, "1.5"));
    // A drag that rests a while, still held, writes nothing yet.
    await pause();
    act(() => enter(mass, "2"));
    expect(written).toEqual([]);
    expect(mass.value).toBe("2");
    await release(mass);
    expect(written).toEqual([
      { op: "set", node: HOLE, field: knobFieldId(HOLE, "mass"), value: { t: "num", v: 2 } },
    ]);
    const warp = backdropVariantOptionId(PROBE.id, "warp");
    const pull = labelled("Pull");
    act(() => enter(pull, "1"));
    await release(pull);
    expect(written.at(-1)).toEqual({
      op: "set",
      node: warp,
      field: knobFieldId(warp, "pull"),
      value: { t: "num", v: 1 },
    });
    expect(written).toHaveLength(2);
  });

  test("a value moved and not yet let go can be reset, alone or with all", async () => {
    act(() => root.render(<StudioPage backdrop={PROBE.id} />));
    const all = button("Reset all");
    expect(all.disabled).toBe(true);
    act(() => enter(labelled("Mass"), "2"));
    expect(all.disabled).toBe(false);
    expect(button("Reset Mass to its default").disabled).toBe(false);
    act(() => all.click());
    expect(labelled("Mass").value).toBe("1");
    await pause();
    expect(written).toEqual([]);
  });

  test("a value held is the control's, and its reset takes it out", () => {
    host.setNodes([
      node(HOLE, { [knobFieldId(HOLE, "mass")]: [{ t: "num", v: 0.5 }] }),
      node(extensionNodeId("core")),
    ]);
    act(() => root.render(<StudioPage backdrop={PROBE.id} />));
    expect(labelled("Mass").value).toBe("0.5");
    expect(
      JSON.parse(document.querySelector("[data-probe]")?.getAttribute("data-knobs") ?? "{}"),
    ).toMatchObject({ mass: 0.5 });
    act(() => button("Reset Mass to its default").click());
    expect(written).toEqual([{ op: "unset", node: HOLE, field: knobFieldId(HOLE, "mass") }]);
  });

  test("“Use as my page backdrop” writes core's backdrop setting", () => {
    act(() => root.render(<StudioPage backdrop={OTHER.id} />));
    act(() => button("Use as my page backdrop").click());
    expect(written).toEqual([
      {
        op: "set",
        node: extensionNodeId("core"),
        field: SYSTEM_IDS.backdropField,
        value: { t: "ref", v: backdropOptionId(OTHER.id) },
      },
    ]);
  });

  test("a backdrop nothing contributes says so", () => {
    act(() => root.render(<StudioPage backdrop="gone.away" />));
    expect(document.body.textContent).toContain("No such backdrop");
    expect(mounts).toEqual([]);
  });
});
