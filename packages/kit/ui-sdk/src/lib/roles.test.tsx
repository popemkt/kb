import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  bindPluginAuthority,
  makeKernel,
  Point,
  Role,
  Service,
  type PluginContext,
} from "@kb/plugin";
import { roleComponent } from "./roles";
import { setToastSink } from "./toast";

interface Props {
  readonly text: string;
}
const Good = ({ text }: Props) => <span>{text}</span>;
function Broken(): never {
  throw new Error("bad provider render");
}

function SometimesBroken({ text }: Props) {
  if (text === "bad row") throw undefined;
  return <span>{text}</span>;
}

let dom: Window;
let container: HTMLDivElement;
let root: Root;
let savedError: typeof console.error;
const notices: string[] = [];
beforeAll(() => {
  dom = new Window();
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
  });
});
beforeEach(() => {
  savedError = console.error;
  console.error = () => {};
  notices.length = 0;
  setToastSink((message) => {
    notices.push(message);
  });
  container = dom.document.createElement("div") as unknown as HTMLDivElement;
  dom.document.body.appendChild(container as unknown as never);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  console.error = savedError;
  setToastSink(() => {});
});

for (const kind of ["service", "single", "keyed"] as const) {
  describe(`page role contract: ${kind}`, () => {
    it("contains a throwing candidate, renders the default and names the failed extension once", async () => {
      const kernel = makeKernel({ host: "page" });
      const spec = { kernel: "page", tier: "T3", replaceable: true } as const;
      const service = Service<ComponentType<Props>>()("test.editor", spec);
      const point = Point<ComponentType<Props>>()("test.editor", {
        ...spec,
        cardinality: kind === "service" ? "single" : kind,
        combine: "elected",
      });
      const role =
        kind === "service" ? Role(service) : Role(point, kind === "keyed" ? "stable" : undefined);
      const give = (ctx: PluginContext, Component: ComponentType<Props>, id: string) =>
        kind === "service"
          ? ctx.provide(service, Component)
          : ctx.contribute(point, {
              id,
              value: Component,
              ...(id === "candidate" && kind === "keyed" ? { replaces: role.name } : {}),
            });
      Effect.runSync(
        kernel.load(
          bindPluginAuthority(
            {
              name: "owner",
              namespace: "",
              apply: (ctx) => give(ctx, Good, "stable").pipe(Effect.asVoid),
            },
            {
              pointNamespace: "owner",
              source: "bundled",
              replacements: [],
              defaults: [{ role: role.name, provider: "owner" }],
            },
          ),
        ),
      );
      const candidate = bindPluginAuthority(
        {
          name: "broken",
          namespace: "",
          apply: (ctx) => give(ctx, Broken, "candidate").pipe(Effect.asVoid),
        },
        {
          pointNamespace: "broken",
          source: "bundled",
          digest: "bad-code",
          replacements: [{ role: role.name }],
          defaults: [],
        },
      );
      Effect.runSync(kernel.load(candidate));
      const Editor = roleComponent(kernel, role);
      expect(roleComponent(kernel, role)).toBe(Editor);
      expect(roleComponent(kernel, Role(role.key, role.cell ?? undefined))).toBe(Editor);
      await act(async () => root.render(<Editor text="default survived" />));
      expect(container.textContent).toBe("default survived");
      expect(notices).toEqual(["broken failed to render."]);
      expect(kernel.roles()[0]?.elected).toBe("owner");
      await act(async () => root.render(<Editor text="still usable" />));
      expect(container.textContent).toBe("still usable");
      expect(notices).toHaveLength(1);
      await act(async () => {
        Effect.runSync(kernel.shutdown);
      });
    });
  });
}

it("a default's render failure stays local while other role instances keep working", async () => {
  const kernel = makeKernel({ host: "page" });
  const key = Service<ComponentType<Props>>()("test.default-floor", {
    kernel: "page",
    tier: "T3",
    replaceable: true,
  });
  const role = Role(key);

  Effect.runSync(
    kernel.load(
      bindPluginAuthority(
        { name: "owner", apply: (ctx) => ctx.provide(key, SometimesBroken) },
        {
          pointNamespace: "owner",
          source: "bundled",
          replacements: [],
          defaults: [{ role: role.name, provider: "owner" }],
        },
      ),
    ),
  );
  const Editor = roleComponent(kernel, role);
  await act(async () =>
    root.render(
      <>
        <Editor text="bad row" />
        <Editor text="healthy row" />
      </>,
    ),
  );
  expect(container.querySelector('[data-testid="view-error"]')).not.toBeNull();
  expect(container.textContent).toContain("healthy row");
  expect(kernel.roles()[0]?.elected).toBe("owner");
  expect(notices).toEqual([]);
  await act(async () => {
    Effect.runSync(kernel.shutdown);
  });
});
