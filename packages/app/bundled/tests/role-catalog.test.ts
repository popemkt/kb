import { expect, test } from "bun:test";
import { ExtensionManifestSchema, extensionAdmissionIssue } from "@kb/contracts";
import { BUNDLED_DECLARATIONS, BUNDLED_CAPABILITIES } from "../src/index.ts";

test("every bundled replacement manifest is well-formed and targets the shared role catalog", () => {
  for (const declaration of BUNDLED_DECLARATIONS) {
    const manifest =
      declaration.manifest === undefined
        ? undefined
        : ExtensionManifestSchema.parse(declaration.manifest);
    expect(
      extensionAdmissionIssue(declaration.name, manifest, BUNDLED_CAPABILITIES),
      declaration.name,
    ).toBeNull();
  }
});
