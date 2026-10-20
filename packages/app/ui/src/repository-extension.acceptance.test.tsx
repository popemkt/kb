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
import {
  PAGE_FAMILY_KERNEL,
  SidebarSectionPoint,
  ViewPoint,
  currentContributions,
  pageFootprint,
  type ViewProps,
} from "@kb/ui-sdk";
import { EXAMPLE_PAGE_HALF } from "@/test-support/example-page.text";

const { setPostAction } = await import("@/api/action");
const { loadManifest } = await import("@/lib/manifest");
const { extensionsSettled, startUiPlugins } = await import("@/ui-plugins");

/** Where the page imports the half from: here, the served bytes themselves. */
const served = (source: string) =>
  `data:text/javascript;base64,${btoa(
    Array.from(new TextEncoder().encode(source), (byte) => String.fromCodePoint(byte)).join(""),
  )}`;
const SERVED_AT = served(EXAMPLE_PAGE_HALF);

/** Where the server says the half is: the example's, or bytes that throw as they are imported. */
let servedAt = SERVED_AT;

/** Whether the server reports the example loaded. */
let loaded = true;

/** What the server reports: every bundled family as a store with no switch has it, and the example. */
function reported() {
  return [
    ...BUNDLED_FAMILIES.map((declaration) =>
      extensionRow(
        declaration,
        "bundled",
        familyOn(declaration, NO_SWITCHES, () => {}),
      ),
    ),
    extensionRow(
      { name: "example", label: "Example", optional: { byDefault: "on" } },
      "/root/.kb/extensions/example.ts",
      loaded,
      servedAt,
    ),
  ];
}

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

  it("loads beside the bundled families, and its view and sidebar section are the page's", async () => {
    loaded = true;
    await follow();
    expect(pageFootprint("example").map(({ kind, id }) => [kind, id])).toEqual([
      ["kb.views", "example.board"],
      ["ui.views", "example.board"],
      ["ui.sidebar", "example.section"],
    ]);
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
    expect(pageFootprint("example").length).toBe(3);
  });

  it("is reported failed, as any plugin of its family is, when its page half cannot be imported, and recovers while on", async () => {
    loaded = true;
    servedAt = SERVED_AT;
    await follow();
    expect(pageFootprint("example").length).toBe(3);

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
    expect(pageFootprint("example").length).toBe(3);
  });
});
