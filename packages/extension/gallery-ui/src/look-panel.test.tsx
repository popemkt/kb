/**
 * The look panel's Enhance (research record §6.5): working while a family
 * provides the page's model completion, it sends the composed prompt and the
 * family's system prompt and shows the rewrite as an editable prompt of its
 * own, for as long as the composition it was made from stands. While none is
 * provided it says what it needs and sends nothing. A failed completion
 * leaves no rewrite and says why. The gallery reaches a model only through
 * `ModelCompletionService`, so these tests provide a stand-in for it, beside
 * the gallery's real `model` child, never a model.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  EMPTY_LOOK,
  composePrompt,
  enhanceInput,
  type Library,
  type StyleEntry,
} from "@kb/gallery";
import { definePlugin } from "@kb/plugin";
import {
  type CompletionReply,
  type CompletionRequest,
  ModelCompletionService,
  setToastSink,
  syncUiPlugins,
  useContributions,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { updateDraft } from "./draft";
import type { ComposerFrame } from "./frame";
import { LookPanel } from "./look-panel";
import { ComposerModelPoint, MODEL_NEEDS, galleryModelPlugin } from "./model";

const ENHANCE_NEEDS = `Enhance ${MODEL_NEEDS}`;
const CINEMATIC: StyleEntry = {
  id: "s.cinematic",
  text: "Cinematic",
  facet: null,
  prompt: "cinematic still {prompt}, film grain",
  negative: "",
  description: "",
  madeWith: [],
  seenIn: [],
  howTo: [],
};
const COMPOSED = composePrompt("", "", [CINEMATIC], "sd").positive;
const LIBRARY: Library = {
  visuals: [],
  styles: new Map([[CINEMATIC.id, CINEMATIC]]),
  facets: [],
  stylesOf: new Map(),
};
const FRAME: ComposerFrame = {
  library: LIBRARY,
  node: () => undefined,
  sources: [],
  saveInto: null,
  model: null,
  board: null,
  open: () => {},
};

/** The panel in a frame whose model is the one offered now, as the page builds it. */
function Framed() {
  const model = useContributions(ComposerModelPoint)[0]?.value ?? null;
  return <LookPanel frame={{ ...FRAME, model }} />;
}
const REWRITE = "A cinematic still on 35 mm film, soft grain, a low sun raking across the frame";
const enhanceButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="gallery-enhance"]');
const rewrite = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Enhanced prompt"]');
/** Click `button`, and let the call it makes answer. */
async function press(button: HTMLElement | null): Promise<void> {
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}
describe("the look's Enhance", () => {
  let dom: InstalledDom;
  let root: Root;
  let answer: () => CompletionReply | Promise<CompletionReply>;
  let calls: CompletionRequest[];
  let toasts: string[];
  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    setToastSink((message) => toasts.push(message));
  });
  afterAll(() => dom.restore());
  /** A stand-in for the family that holds a model: it provides the page's completion. */
  const model = definePlugin({
    name: "agent",
    apply: (ctx) =>
      ctx.provide(ModelCompletionService, {
        complete: (request) => {
          calls.push(request);
          return Promise.resolve(answer());
        },
        pictures: 4,
        sees: () => Promise.resolve(false),
      }),
  });
  /** The page's plugins, with or without a family that provides a completion. */
  const provided = (on: boolean) =>
    act(() => syncUiPlugins(on ? [model, galleryModelPlugin] : [galleryModelPlugin]));
  beforeEach(() => {
    calls = [];
    toasts = [];
    answer = () => ({ ok: true, text: REWRITE, saw: 0 });
    provided(true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    syncUiPlugins([]);
  });
  const render = (styles: readonly StyleEntry[] = [CINEMATIC]) => {
    updateDraft(() => ({ ...EMPTY_LOOK, styles: styles.map((style) => style.id) }));
    act(() => root.render(<Framed />));
  };
  test("says what it needs while no family provides a completion, and works once one does", async () => {
    provided(false);
    render();
    expect(enhanceButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(enhanceButton()?.title).toBe(ENHANCE_NEEDS);
    await press(enhanceButton());
    expect(toasts).toEqual([ENHANCE_NEEDS]);
    expect(calls).toEqual([]);
    expect(rewrite()).toBeNull();
    // The family is switched on: the enhance child stops waiting.
    provided(true);
    expect(enhanceButton()?.getAttribute("aria-disabled")).toBe("false");
    await press(enhanceButton());
    expect(rewrite()?.value).toBe(REWRITE);
  });
  test("waits for a prompt to enhance", () => {
    render([]);
    expect(enhanceButton()?.disabled).toBe(true);
  });
  test("sends the composed prompt for its family, and shows the rewrite as an editable prompt", async () => {
    render();
    await press(enhanceButton());
    expect(calls).toEqual([enhanceInput(COMPOSED, "sd")]);
    expect(rewrite()?.value).toBe(REWRITE);
    // The person edits it as their own.
    const area = rewrite();
    act(() => {
      if (area === null) return;
      // React reads a typed value through the element's own setter.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(area), "value")?.set?.call(
        area,
        `${REWRITE}, dusk`,
      );
      area.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
    });
    expect(rewrite()?.value).toBe(`${REWRITE}, dusk`);
  });
  test("a rewrite goes with the composition it was made from", async () => {
    render();
    await press(enhanceButton());
    expect(rewrite()).not.toBeNull();
    // Another family is another composition: the rewrite was not made for it.
    await press(
      [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (radio) => radio.textContent === "FLUX",
      ) ?? null,
    );
    expect(rewrite()).toBeNull();
  });
  test("a composition changed mid-ask may be enhanced at once, and the late answer is not shown", async () => {
    const replies: ((reply: CompletionReply) => void)[] = [];
    answer = () => new Promise((resolve) => replies.push(resolve));
    render();
    await press(enhanceButton());
    expect(enhanceButton()?.textContent).toBe("Enhancing…");
    // Another family is another composition: Enhance is offered for it while the first ask runs.
    await press(
      [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (radio) => radio.textContent === "FLUX",
      ) ?? null,
    );
    expect(enhanceButton()?.textContent).toBe("Enhance");
    expect(enhanceButton()?.disabled).toBe(false);
    await press(enhanceButton());
    const [first, second] = replies;
    // The first answer arrives late: the later ask supersedes it.
    await act(async () => {
      first?.({ ok: true, text: "for Stable Diffusion", saw: 0 });
      await Promise.resolve();
    });
    expect(rewrite()).toBeNull();
    await act(async () => {
      second?.({ ok: true, text: REWRITE, saw: 0 });
      await Promise.resolve();
    });
    expect(rewrite()?.value).toBe(REWRITE);
    expect(calls.map((call) => call.system?.includes("FLUX"))).toEqual([false, true]);
  });

  test("a failed completion leaves no rewrite, and says why", async () => {
    answer = () => ({
      ok: false,
      reason: "agent provider Local proxy is not trusted on this machine",
    });
    render();
    await press(enhanceButton());
    expect(rewrite()).toBeNull();
    expect(toasts).toEqual([
      "Could not enhance the prompt: agent provider Local proxy is not trusted on this machine",
    ]);
    expect(enhanceButton()?.disabled).toBe(false);
  });

  test("exports the look as the brief or as its 3D art direction, chosen like the model family", () => {
    render();
    const exports = document.querySelector('[data-testid="gallery-exports"]');
    const choices = [...(exports?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    expect(choices.map((c) => c.textContent)).toEqual(["Brief", "3D art direction"]);
    const shown = () => exports?.querySelector("[data-gallery-export]");
    expect(shown()?.getAttribute("data-gallery-export")).toBe("brief");
    expect(shown()?.textContent).toContain("## Prompts");
    act(() => choices[1]?.click());
    expect(choices[1]?.getAttribute("aria-checked")).toBe("true");
    expect(shown()?.getAttribute("data-gallery-export")).toBe("art-direction");
    expect(shown()?.textContent).toContain(": 3D art direction");
    expect(shown()?.textContent).toContain("- Cinematic");
  });
});
