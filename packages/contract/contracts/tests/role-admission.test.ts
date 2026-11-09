import { expect, test } from "bun:test";
import {
  hostCapabilities,
  FIELD_EDITOR_ROLE,
  extensionAdmissionIssue,
  ExtensionManifestSchema,
  type ExtensionManifest,
} from "../src/index.ts";

const roles = hostCapabilities([{ name: "outline", label: "Outline", roles: [FIELD_EDITOR_ROLE] }]);
const manifest: ExtensionManifest = {
  replaces: [{ role: "ui.field-editor", why: "One-line rows" }],
  capabilities: { page: "full" },
};

test("manifest role claims are data with a finite priority and a reason", () => {
  expect(ExtensionManifestSchema.parse(manifest).replaces).toEqual(manifest.replaces);
  for (const priority of [Infinity, NaN, -Infinity])
    expect(
      ExtensionManifestSchema.safeParse({
        replaces: [{ role: "ui.field-editor", why: "rows", priority }],
      }).success,
    ).toBe(false);
  expect(
    ExtensionManifestSchema.safeParse({ replaces: [{ role: "ui.field-editor", why: " " }] })
      .success,
  ).toBe(false);
});

test("one role has one replacement declaration", () => {
  expect(
    ExtensionManifestSchema.safeParse({
      ...manifest,
      replaces: [...(manifest.replaces ?? []), ...(manifest.replaces ?? [])],
    }).success,
  ).toBe(false);
});

test("replacement admission checks the declared role and its page tier", () => {
  expect(extensionAdmissionIssue("plain-fields", manifest, roles)).toBeNull();
  expect(
    extensionAdmissionIssue(
      "plain-fields",
      { replaces: [{ role: "ui.host", why: "hijack" }] },
      roles,
    ),
  ).toMatch(/no replaceable role/);
  expect(
    extensionAdmissionIssue(
      "plain-fields",
      { ...manifest, capabilities: { page: "drawing" } },
      roles,
    ),
  ).toMatch(/requires capabilities.page: full/);
  expect(extensionAdmissionIssue("outline", manifest, roles)).toMatch(/already owns its default/);
});

test("server roles impose no page access requirement", () => {
  const serverRoles = hostCapabilities([
    {
      name: "owner",
      label: "Owner",
      roles: [
        {
          role: "server.test",
          label: "Test",
          spec: { replaceable: true, kernel: "server", tier: "T3" },
        },
      ],
    },
  ]);
  expect(
    extensionAdmissionIssue(
      "other",
      { replaces: [{ role: "server.test", why: "server provider" }] },
      serverRoles,
    ),
  ).toBeNull();
});
