/**
 * Who may take a held key by naming what it replaces (DESIGN-UI.md →
 * Keybindings): the host answers by the origin the server reports for the
 * owner's family. kb's own code and the repository's own folder may; a
 * linked or installed extension waits for a person to approve the
 * replacement (GAP [[01M6YFRJGV8MAF2AM34N567MBQ]]); a family the report does
 * not name is the page's own build.
 */
import { afterAll, describe, expect, it } from "vitest";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { extensionRow, type ExtensionOrigin } from "@kb/contracts";
import { replacementApproved } from "@/browser-host";
import { loadManifest } from "@/lib/manifest";

const [base] = BUNDLED_FAMILIES;
if (base === undefined) throw new Error("no bundled family to model a row on");
const BASE_ROW = extensionRow(base, "bundled", true);

/** A reported family `name` from `origin`. */
function row(name: string, origin: ExtensionOrigin) {
  return { ...BASE_ROW, name, origin };
}

const LOCKED = {
  repo: "owner/repo",
  path: "extensions/keys",
  rev: "0".repeat(40),
  files: `sha256:${"0".repeat(64)}`,
};

describe("a replacement's approval, by its owner's origin", () => {
  afterAll(() =>
    loadManifest(Promise.resolve({ manifest: { actions: [], views: [], extensions: [] } })),
  );

  it("is kb's own and the repository's own folder's, and waits for a linked or installed one", async () => {
    await loadManifest(
      Promise.resolve({
        manifest: {
          actions: [],
          views: [],
          extensions: [
            row("built", { kind: "bundled" }),
            row("hosted", { kind: "host" }),
            row("own-keys", { kind: "own" }),
            row("linked-keys", { kind: "link", scope: "user" }),
            row("installed-keys", {
              kind: "install",
              scope: "store",
              selection: { original: "installed-keys@market", locked: LOCKED },
            }),
          ],
        },
      }),
    );
    expect(replacementApproved("built")).toBe(true);
    expect(replacementApproved("hosted")).toBe(true);
    expect(replacementApproved("own-keys")).toBe(true);
    // A child plugin answers for its family.
    expect(replacementApproved("own-keys/child")).toBe(true);
    expect(replacementApproved("linked-keys")).toBe(false);
    expect(replacementApproved("installed-keys")).toBe(false);
    expect(replacementApproved("installed-keys/child")).toBe(false);
    // Not reported: a plugin of the page's own build.
    expect(replacementApproved("outline")).toBe(true);
  });
});
