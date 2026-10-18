/**
 * A repository extension's page half reaches the page through the `kb ui`
 * server: its row in the manifest names a path addressed by its closure's
 * digest (`extensionPagePath`), and the server answers that path with the
 * closure's page half, a module the page imports. A path no trusted
 * closure has is not found.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { extensionPagePath } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { EXAMPLE, examplePageHalf, writeTrustedExample } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

let root = "";
let digest = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-extension-page-"));
  digest = await writeTrustedExample(root);
  handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

describe("a repository extension's page half", () => {
  test("the manifest names where it is served, and the server serves its closure's bytes there", async () => {
    // What the page asks: `kb.manifest`, whose rows it follows.
    const answered = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: kbManifestDef.id, input: {} }),
    });
    const receipt = (await answered.json()) as { output?: unknown };
    const rows = kbManifestDef.outputSchema.parse(receipt.output).extensions;
    const row = rows.find(({ name }) => name === EXAMPLE);
    expect(row?.page).toBe(extensionPagePath(digest));

    const served = await fetch(`${handle.url}${row?.page ?? ""}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(await served.text()).toBe(await Effect.runPromise(examplePageHalf()));
  });

  test("a path no trusted closure has is not found", async () => {
    const missing = await fetch(`${handle.url}${extensionPagePath(`sha256:${"0".repeat(64)}`)}`);
    expect(missing.status).toBe(404);
  });
});
