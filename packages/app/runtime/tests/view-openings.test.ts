/**
 * `view.openings` answers the ways a node opens as the UI's "Open with…"
 * offers them, and a tag's default view type is a person's to change through
 * the action registry like any setting (DESIGN.md → View nodes).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_IDS } from "@kb/model";
import type { KbContext } from "@kb/contracts";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

const CANVAS_TAG = "sys.tag.canvas";

let root: string;
let ctx: KbContext;

async function mustInvoke(id: string, input: unknown): Promise<unknown> {
  const receipt = await invoke(ctx, { id, input });
  if (receipt.status !== "succeeded") throw new Error(`${id}: ${receipt.message}`);
  return receipt.output;
}

interface Openings {
  readonly openings: readonly {
    view?: string;
    label: string;
    viewType?: string;
    tag?: string;
    default: boolean;
    path: string;
  }[];
}

const defaultOf = async (node: string) =>
  ((await mustInvoke("view.openings", { node })) as Openings).openings.find(
    (opening) => opening.default,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-view-openings-"));
  ctx = await openKb(root);
  await mustInvoke("node.add", { id: "n.board", text: "Board", tags: ["canvas"] });
  await mustInvoke("node.add", { id: "n.plain", text: "Plain" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("view.openings", () => {
  test("a canvas opens in its canvas by default, and can open in the outline", async () => {
    const { openings } = (await mustInvoke("view.openings", { node: "n.board" })) as Openings;
    expect(openings[0]).toEqual({ label: "Default view", default: false, path: "/node/n.board" });
    expect(openings[1]).toEqual({
      view: "sys.view.canvas.page",
      label: "Canvas",
      viewType: "canvas.page",
      tag: CANVAS_TAG,
      default: true,
      path: "/node/n.board/sys.view.canvas.page",
    });
    expect(openings.map((opening) => opening.viewType)).toContain("outline.main");
  });

  test("a plain node opens in the store's default", async () => {
    expect((await defaultOf("n.plain"))?.viewType).toBe("outline.main");
  });

  test("a tag's default is written on the tag node without force, and its nodes follow", async () => {
    await mustInvoke("node.update", {
      id: CANVAS_TAG,
      setProps: [
        { field: SYSTEM_IDS.viewDefaultField, value: { t: "ref", v: "sys.view.outline.main" } },
      ],
    });
    expect((await defaultOf("n.board"))?.viewType).toBe("outline.main");
  });

  test("a missing node is not found", async () => {
    const receipt = await invoke(ctx, { id: "view.openings", input: { node: "n.none" } });
    expect(receipt).toMatchObject({ status: "failed", code: "not_found" });
  });
});
