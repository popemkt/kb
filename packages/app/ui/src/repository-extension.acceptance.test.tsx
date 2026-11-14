/**
 * A repository extension's page half, through the page's own loading
 * (`ui-plugins.ts`): the server's manifest reports the example extension
 * loaded, its row naming where its page half is served, and the page
 * imports those bytes (`EXAMPLE_PAGE_HALF`, the closure's page half as a
 * server serves it, held to a fresh bundle by `@kb/test-kit`) beside the
 * bundled families' entries, through the one convergence. Its view and its
 * sidebar section are then the page's, drawn with the page's own React and
 * host API; reported off, they leave with it. The server half of the same
 * extension is `@kb/runtime`'s `example-extension.test.ts`.
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { NO_SWITCHES, extensionRow, familyOn, organisationOf } from "@kb/contracts";
import { BackdropPoint } from "@kb/appearance-kit";
import {
  PAGE_FAMILY_KERNEL,
  SidebarSectionPoint,
  chosenDeclared,
  ViewPoint,
  currentContributions,
  pageFootprint,
  type ViewProps,
} from "@kb/ui-sdk";
import { EXAMPLE_PAGE_HALF } from "@/test-support/example-page.text";
import { EXAMPLE_SERVED_AT, servedAt as served } from "@/test-support/example-page-half";

const { setPostAction } = await import("@/api/action");
const { loadManifest } = await import("@/lib/manifest");
const { BROWSER_EXTENSIONS, extensionsSettled, startUiPlugins } = await import("@/ui-plugins");

const SERVED_AT = EXAMPLE_SERVED_AT;

/**
 * How many contributions the example's page half makes: its views' keys and
 * drawings, its section, its keys, its node command, its picker step, its
 * paste handler and its backdrop.
 */
const FOOTPRINT = 14;

/** Where the server says the half is: the example's, or bytes that throw as they are imported. */
let servedAt = SERVED_AT;

/** Whether the server reports the example loaded. */
let loaded = true;
/** Whether the server reports the lab loaded (off in a store with no switch written). */
let labOn = false;

/** What the server reports: every bundled family as a store with no switch has it, and the example. */
function reported() {
  return [
    ...BUNDLED_FAMILIES.map((declaration) =>
      extensionRow(
        declaration,
        "bundled",
        (declaration.name === "lab" && labOn) || familyOn(declaration, NO_SWITCHES, () => {}),
      ),
    ),
    extensionRow(
      { name: "example", label: "Example", optional: { byDefault: "on" } },
      { source: "/root/.kb/extensions/example.ts", origin: { kind: "own" } },
      loaded,
      servedAt,
    ),
  ];
}

/** The backdrop a page that chose the example's glow shows, as the slot reads its choice. */
const chosen = () => chosenDeclared(currentContributions(BackdropPoint), "example.glow");

/** Ask the server again, and wait until the page holds what it reports. */
async function follow(): Promise<void> {
  await loadManifest();
  await extensionsSettled();
}

describe("a repository extension's page half (acceptance)", () => {
  let stop: () => void;

  beforeAll(() => {
    setPostAction(async (invocation) =>
      invocation.id === "kb.manifest"
        ? {
            status: "succeeded",
            id: invocation.id,
            output: { actions: [], views: [], extensions: reported() },
            rev: 1,
          }
        : { status: "failed", id: invocation.id, code: "unknown_action", message: "none", rev: 1 },
    );
    stop = startUiPlugins();
  });

  afterAll(() => {
    stop();
    setPostAction(null);
  });

  it("loads beside the bundled families, and its views, sidebar section, keys, command, step, paste handler and field type's kind are the page's", async () => {
    loaded = true;
    await follow();
    expect(pageFootprint("example").map(({ kind, id }) => [kind, id])).toEqual([
      ["ui.value-kinds", "example.stars"],
      ["ui.keybindings", "example.move-up"],
      ["ui.keybindings", "example.move-up-selected"],
      ["ui.keybindings", "example.stamp"],
      ["ui.keybindings", "example.unrate"],
      ["kb.views", "example.board"],
      ["kb.views", "example.note"],
      ["ui.palette-steps", "example.link"],
      ["ui.views", "example.board"],
      ["ui.views", "example.note"],
      ["ui.sidebar", "example.section"],
      ["outline.ingest", "example.ratings"],
      ["ui.commands", "example.link"],
      ["ui.backdrops", "example.glow"],
    ]);
  });

  it("its backdrop is one a page can choose, and a page that chose it falls through once it is off", async () => {
    loaded = true;
    await follow();
    expect(chosen()?.value.key).toMatchObject({
      id: "example.glow",
      credit: "The example extension",
    });
    loaded = false;
    await follow();
    expect(chosen()?.value.key.id).not.toBe("example.glow");
    expect(chosen()).toEqual(currentContributions(BackdropPoint)[0]);
    loaded = true;
    await follow();
  });

  it("draws with the page's own React", async () => {
    loaded = true;
    await follow();
    const view = currentContributions(ViewPoint).find(({ id }) => id === "example.board");
    const section = currentContributions(SidebarSectionPoint).find(
      ({ id }) => id === "example.section",
    );
    const Board = view?.value.Component as ComponentType<ViewProps<unknown>> | undefined;
    expect(
      Board === undefined
        ? null
        : renderToStaticMarkup(createElement(Board, { params: {}, host: { placement: "page" } })),
    ).toBe('<section data-example="board">An example board</section>');
    expect(
      section === undefined
        ? null
        : renderToStaticMarkup(createElement(section.value.Component, { route: null })),
    ).toBe('<nav data-example="section">Example</nav>');
  });

  it("leaves with everything it contributed when the server reports it off, and comes back on", async () => {
    loaded = false;
    await follow();
    expect(pageFootprint("example")).toEqual([]);
    loaded = true;
    await follow();
    expect(pageFootprint("example").length).toBe(FOOTPRINT);
  });

  it("is reported failed, as any plugin of its family is, when its page half cannot be imported, and recovers while on", async () => {
    loaded = true;
    servedAt = SERVED_AT;
    await follow();
    expect(pageFootprint("example").length).toBe(FOOTPRINT);

    // Re-served from bytes that throw, the family still on: the working
    // half gives way, and its failure is the family's.
    servedAt = served('throw new Error("boom at import");');
    await follow();
    expect(pageFootprint("example")).toEqual([]);
    expect(organisationOf("example", [PAGE_FAMILY_KERNEL]).failures).toEqual([
      expect.stringContaining("boom at import"),
    ]);

    // Read again from the same bytes: nothing moves.
    await follow();
    expect(organisationOf("example", [PAGE_FAMILY_KERNEL]).failures).toHaveLength(1);

    // Re-served from working bytes, still on: it recovers without a reload.
    servedAt = served(`${EXAMPLE_PAGE_HALF}\n// re-served`);
    await follow();
    expect(organisationOf("example", [PAGE_FAMILY_KERNEL]).failures).toEqual([]);
    expect(pageFootprint("example").length).toBe(FOOTPRINT);
  });

  it("tries a browser entry that failed again, so one that was passing recovers without a reload", async () => {
    const lab = BROWSER_EXTENSIONS.lab;
    if (lab === null || lab === undefined) throw new Error("the lab has a browser entry");
    const load = lab.load;
    let tries = 0;
    // The network drops the chunk once.
    (lab as { load: typeof load }).load = () => {
      tries += 1;
      return tries === 1 ? Promise.reject(new Error("chunk dropped")) : load();
    };
    try {
      labOn = true;
      await follow();
      expect(organisationOf("lab", [PAGE_FAMILY_KERNEL]).failures).toEqual([
        expect.stringContaining("chunk dropped"),
      ]);
      await follow();
      expect(tries).toBe(2);
      expect(organisationOf("lab", [PAGE_FAMILY_KERNEL]).failures).toEqual([]);
      expect(pageFootprint("lab").length).toBeGreaterThan(0);
    } finally {
      (lab as { load: typeof load }).load = load;
      labOn = false;
      await follow();
    }
  });
});
