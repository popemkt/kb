/**
 * What an extension says about itself (docs/extensions/README.md): the
 * manifest's shape, which refuses what it does not know; the plain words a
 * person reads each capability in, "not declared" apart from "none"; and
 * what a marketplace listing still needs.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExtensionManifestSchema,
  capabilityLines,
  listingMissing,
  type ExtensionManifest,
} from "@kb/contracts";

const FULL: ExtensionManifest = {
  description: "Says hello",
  author: "Ada",
  homepage: "https://example.com/hello",
  repository: "https://github.com/example/hello",
  license: "MIT",
  capabilities: {
    network: { hosts: ["api.example.com"] },
    storage: [{ kind: "files", what: "its greetings", where: "<data>/hello" }],
    secrets: [{ name: "HELLO_TOKEN", why: "to sign greetings" }],
    data: { reads: ["#person"], writes: ["greeting"] },
    page: "none",
    services: [],
    approvals: ["ext.hello.send"],
  },
};

describe("the manifest's shape", () => {
  test("takes every field, and none of them is needed", () => {
    expect(ExtensionManifestSchema.parse(FULL)).toEqual(FULL);
    expect(ExtensionManifestSchema.parse({})).toEqual({});
  });

  test("refuses a field it does not know, so a misspelt one is not silently dropped", () => {
    expect(ExtensionManifestSchema.safeParse({ licence: "MIT" }).success).toBe(false);
    expect(
      ExtensionManifestSchema.safeParse({ capabilities: { netwrok: { hosts: [] } } }).success,
    ).toBe(false);
  });

  test("takes links over https only, and words that are not blank", () => {
    expect(ExtensionManifestSchema.safeParse({ homepage: "http://example.com" }).success).toBe(
      false,
    );
    expect(ExtensionManifestSchema.safeParse({ author: "  " }).success).toBe(false);
    expect(
      ExtensionManifestSchema.safeParse({ capabilities: { page: "everything" } }).success,
    ).toBe(false);
  });
});

describe("each capability in plain words", () => {
  test("a manifest that says nothing reads as not declared, line by line", () => {
    const lines = capabilityLines(undefined);
    expect(lines.map(({ label }) => label)).toEqual([
      "Network",
      "Storage",
      "Secrets",
      "kb data",
      "Page",
      "Background",
      "Approvals",
    ]);
    expect(lines.every(({ text, said }) => text === "not declared" && !said)).toBe(true);
  });

  test("an empty list says none, which is a statement, not silence", () => {
    const lines = capabilityLines({
      capabilities: { network: { hosts: [] }, storage: [], secrets: [], services: [] },
    });
    const words = Object.fromEntries(lines.map(({ label, text }) => [label, text]));
    expect(words).toMatchObject({
      Network: "no network access",
      Storage: "keeps nothing outside kb's graph",
      Secrets: "needs no secrets",
      Background: "runs nothing in the background",
      Page: "not declared",
    });
  });

  test("what it declares, it says in words", () => {
    const words = Object.fromEntries(capabilityLines(FULL).map(({ label, text }) => [label, text]));
    expect(words).toEqual({
      Network: "reaches api.example.com",
      Storage: "keeps its greetings in its own files at <data>/hello",
      Secrets: "needs HELLO_TOKEN: to sign greetings",
      "kb data": "reads #person; writes greeting",
      Page: "no page half",
      Background: "runs nothing in the background",
      Approvals: "asks before ext.hello.send",
    });
  });
});

describe("a marketplace listing", () => {
  test("needs the four facts and every capability declared", () => {
    expect(listingMissing(FULL)).toEqual([]);
    expect(listingMissing({ description: "x", capabilities: { page: "none" } })).toEqual([
      "author",
      "license",
      "repository",
      "capabilities.network",
      "capabilities.storage",
      "capabilities.secrets",
      "capabilities.data",
      "capabilities.services",
      "capabilities.approvals",
    ]);
  });

  test("the template's manifest is one a listing takes", () => {
    const template = join(
      import.meta.dir,
      "../../../../docs/extensions/template/hello.manifest.json",
    );
    const manifest = ExtensionManifestSchema.parse(JSON.parse(readFileSync(template, "utf8")));
    expect(listingMissing(manifest)).toEqual([]);
  });
});
