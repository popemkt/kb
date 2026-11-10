// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A Unicorn scene whose backdrop goes while it starts cold (DESIGN-UI.md →
// Page-head backdrops, the Unicorn scene's runtime): the page crossfades away
// from Unicorn while the scene's file is still loading, and only then does
// the file arrive. The runtime finishes starting the scene it was asked for,
// kb destroys it once it has, and nothing throws. (The page's own backdrop
// field shows a Unicorn card with a scene of its own, which stays.)
import { SYSTEM_IDS, backdropOptionId } from "@kb/model";
import type { APIRequestContext } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const CORE = "sys.extension.core";
const ROOT = "render.fixture.root";
const OWN = "unicorn.cold.own";
const UNICORN = "backdrops.unicorn";
const BLACK_HOLE = "backdrops.black-hole";
const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";

const ref = (v: string) => ({ t: "ref", v });

interface Started {
  readonly element: HTMLElement;
  readonly initializing?: boolean;
  readonly destroyed?: boolean;
}

/** Records each scene the runtime hands over, from the first script on. */
function recordScenes() {
  const scenes: Started[] = [];
  Object.assign(window, { kbScenes: scenes });
  let runtime: Record<string, unknown> | undefined;
  Object.defineProperty(window, "UnicornStudio", {
    configurable: true,
    get: () => runtime,
    set(value: Record<string, unknown>) {
      let addScene: (options: unknown) => Promise<Started>;
      Object.defineProperty(value, "addScene", {
        configurable: true,
        enumerable: true,
        get: () => (options: unknown) =>
          addScene(options).then((scene) => {
            scenes.push(scene);
            return scene;
          }),
        set: (given: typeof addScene) => {
          addScene = given;
        },
      });
      runtime = value;
    },
  });
}

/** Whether the scene the head asked for was handed over, and whether it is destroyed. */
function headScene() {
  const { kbHead, kbScenes } = window as unknown as { kbHead: Element | null; kbScenes: Started[] };
  const scene = kbScenes.find((one) => kbHead !== null && one.element === kbHead);
  return { started: scene !== undefined, destroyed: scene?.destroyed === true };
}

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
}

test("a Unicorn scene let go while it starts cold is destroyed once started, and nothing throws", async ({
  page,
  harness,
  request,
}) => {
  test.setTimeout(120_000);
  await action(request, "node.update", {
    id: CORE,
    setProps: [{ field: SYSTEM_IDS.backdropField, value: ref(backdropOptionId(UNICORN)) }],
  });
  await action(request, "node.add", {
    id: OWN,
    text: "A page with a backdrop of its own",
    parent: ROOT,
    props: [{ field: SYSTEM_IDS.backdropField, value: ref(backdropOptionId(BLACK_HOLE)) }],
  });
  await page.addInitScript(recordScenes);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The scene's file is held until the page has moved on: a cold start, as slow as it can be.
  const held = Promise.withResolvers<void>();
  let asked = false;
  await page.route("**/vendor/unicorn/scene.json", async (route) => {
    asked = true;
    await held.promise;
    await route.continue();
  });

  await page.goto(`${harness.url}/node/${ROOT}`);
  await expect(page.locator(FRAME)).toHaveAttribute("data-backdrop", UNICORN, { timeout: 20_000 });
  await expect.poll(() => asked, { timeout: 20_000 }).toBe(true);
  await page.evaluate((frame) => {
    Object.assign(window, { kbHead: document.querySelector(`${frame} .kb-unicorn-backdrop`) });
  }, FRAME);
  await page.evaluate((to) => {
    history.pushState({}, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/node/${OWN}`);
  // The crossfade runs its course, and the layer it left goes, its scene's element with it.
  await expect(page.locator('[data-backdrop-layer="shown"] .kb-header-backdrop')).toHaveAttribute(
    "data-backdrop",
    BLACK_HOLE,
  );
  await expect(page.locator('[data-backdrop-layer="leaving"]')).toHaveCount(0, { timeout: 10_000 });

  held.resolve();
  // The runtime starts the scene it was asked for, and kb destroys it once it has.
  await expect
    .poll(() => page.evaluate(headScene), { timeout: 10_000 })
    .toEqual({ started: true, destroyed: true });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
