/**
 * The composer's Enhance (research record §6.5): working while a family
 * provides the page's model completion, it sends the composed prompt and the
 * family's system prompt and shows the rewrite as an editable prompt of its
 * own, for as long as the composition it was made from stands. While none is
 * provided it says what it needs and sends nothing. A failed completion
 * leaves no rewrite and says why. The gallery reaches a model only through
 * `ModelCompletionService`, so these tests provide a stand-in for it, beside
 * the gallery's real `enhance` child, never a model.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { composePrompt, enhanceInput, type StyleEntry } from "@kb/gallery";
import { definePlugin } from "@kb/plugin";
import {
  type CompletionReply,
  type CompletionRequest,
  ModelCompletionService,
  setToastSink,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { ComposePanel } from "./compose-panel";
import { ENHANCE_NEEDS, galleryEnhancePlugin } from "./enhance";
const CINEMATIC: StyleEntry = {
  id: "s.cinematic",
  text: "Cinematic",
  facet: null,
  prompt: "cinematic still {prompt}, film grain",
  negative: "",
};
const COMPOSED = composePrompt("", "", [CINEMATIC], "sd").positive;
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
describe("the composer's Enhance", () => {
  let dom: InstalledDom;
  let root: Root;
  let answer: () => CompletionReply;
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
    name: "model",
    apply: (ctx) =>
      ctx.provide(ModelCompletionService, {
        complete: (request) => {
          calls.push(request);
          return Promise.resolve(answer());
        },
      }),
  });
  /** The page's plugins, with or without a family that provides a completion. */
  const provided = (on: boolean) =>
    act(() => syncUiPlugins(on ? [model, galleryEnhancePlugin] : [galleryEnhancePlugin]));
  beforeEach(() => {
    calls = [];
    toasts = [];
    answer = () => ({ ok: true, text: REWRITE });
    provided(true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    syncUiPlugins([]);
  });
  const render = (styles: readonly StyleEntry[] = [CINEMATIC]) =>
    act(() => root.render(<ComposePanel styles={styles} onRemove={() => {}} />));
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
});
