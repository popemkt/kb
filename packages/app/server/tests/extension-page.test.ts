/**
 * A repository extension's page half reaches the page through the `kb ui`
 * server: its row in the manifest names a path addressed by its closure's
 * digest (`extensionPagePath`), and the server answers that path with the
 * closure's page half, a module the page imports, as a script for this
 * origin alone. A path no trusted closure has is not found, and trust is
 * read on every request: untrusted in the running server, the extension's
 * action and its page half are gone; trusted again, both are back.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { extensionPagePath } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { EXAMPLE, examplePageHalf, trustExtension, writeTrustedExample } from "@kb/test-kit";
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

/** Invoke `id` over the page's own endpoint; its receipt's output. */
async function invoke(id: string, input: unknown): Promise<unknown> {
  const answered = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, input }),
  });
  return ((await answered.json()) as { output?: unknown }).output;
}

/** What the page follows: `kb.manifest`. */
async function manifest() {
  return kbManifestDef.outputSchema.parse(await invoke(kbManifestDef.id, {}));
}

describe("a repository extension's page half", () => {
  test("the manifest names where it is served, and the server serves its closure's bytes there", async () => {
    const row = (await manifest()).extensions.find(({ name }) => name === EXAMPLE);
    expect(row?.page).toBe(extensionPagePath(digest));

    const served = await fetch(`${handle.url}${row?.page ?? ""}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(served.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await served.text()).toBe(await Effect.runPromise(examplePageHalf()));
  });

  test("untrusted in the running server, its action and its page half are gone; trusted again, both are back", async () => {
    const page = `${handle.url}${extensionPagePath(digest)}`;
    const greets = async () =>
      (await manifest()).actions.some(({ id }) => id === "ext.example.greet");
    expect(await greets()).toBe(true);

    await invoke("sandbox.untrust", { digest });
    expect(await greets()).toBe(false);
    expect((await manifest()).extensions.some(({ name }) => name === EXAMPLE)).toBe(false);
    expect((await fetch(page)).status).toBe(404);

    await trustExtension(root, "example.ts");
    expect(await greets()).toBe(true);
    expect((await fetch(page)).status).toBe(200);
  });

  test("a path no trusted closure has is not found", async () => {
    const missing = await fetch(`${handle.url}${extensionPagePath(`sha256:${"0".repeat(64)}`)}`);
    expect(missing.status).toBe(404);
  });
});
