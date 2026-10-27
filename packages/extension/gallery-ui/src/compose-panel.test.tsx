/**
 * The composer's Enhance (research record §6.5): offered only while the
 * server serves the agent's completion, it sends the composed prompt and the
 * family's system prompt to `ext.agent.complete` and shows the rewrite as an
 * editable prompt of its own, for as long as the composition it was made
 * from stands. A failed completion leaves no rewrite and says why. The panel
 * reaches the server only through the page's host, so these tests hold it to
 * that port (a test host), never to a model.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { ActionReceipt } from "@kb/contracts";
import { composePrompt, ENHANCE_ACTION, enhanceInput, type StyleEntry } from "@kb/gallery";
import { setToastSink, syncUiPlugins } from "@kb/ui-sdk";
import {
  installDomGlobals,
  type InstalledDom,
  testBrowserHost,
  testHostPlugin,
  type TestBrowserHost,
} from "@kb/ui-test-kit";
import { ComposePanel } from "./compose-panel";
const CINEMATIC: StyleEntry = {
  id: "s.cinematic",
  text: "Cinematic",
  facet: null,
  prompt: "cinematic still {prompt}, film grain",
  negative: "",
};
const COMPOSED = composePrompt("", "", [CINEMATIC], "sd").positive;
const REWRITE = "A cinematic still on 35 mm film, soft grain, a low sun raking across the frame";
interface Call {
  readonly id: string;
  readonly input: unknown;
}
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
  let host: TestBrowserHost;
  let served: boolean;
  let answer: (id: string) => ActionReceipt;
  let calls: Call[];
  let toasts: string[];
  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    setToastSink((message) => toasts.push(message));
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    served = true;
    calls = [];
    toasts = [];
    answer = (id) => ({
      status: "succeeded",
      id,
      output: { text: `\n${REWRITE}  `, truncated: false, provider: "scripted" },
    });
    host = testBrowserHost({
      serves: (id) => served && id === ENHANCE_ACTION,
      invoke: (id, input) => {
        calls.push({ id, input });
        return Promise.resolve(answer(id));
      },
    });
    syncUiPlugins([testHostPlugin(host)]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    syncUiPlugins([]);
  });
  const render = (styles: readonly StyleEntry[] = [CINEMATIC]) =>
    act(() => root.render(<ComposePanel styles={styles} onRemove={() => {}} />));
  test("is offered only while the server serves the agent's completion", () => {
    served = false;
    render();
    expect(enhanceButton()).toBeNull();
    // The server's manifest is read again, and now lists it.
    served = true;
    act(() => host.setNodes([]));
    expect(enhanceButton()?.textContent).toBe("Enhance");
  });
  test("waits for a prompt to enhance", () => {
    render([]);
    expect(enhanceButton()?.disabled).toBe(true);
  });
  test("sends the composed prompt for its family, and shows the rewrite as an editable prompt", async () => {
    render();
    await press(enhanceButton());
    expect(calls).toEqual([{ id: ENHANCE_ACTION, input: enhanceInput(COMPOSED, "sd") }]);
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
    answer = (id) => ({
      status: "failed",
      id,
      code: "internal",
      message: "agent provider Local proxy is not trusted on this machine",
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
