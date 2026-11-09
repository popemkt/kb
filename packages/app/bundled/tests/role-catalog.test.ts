import { expect, test } from "bun:test";
import { ExtensionManifestSchema, replacementIssue } from "@kb/contracts";
import { BUNDLED_DECLARATIONS, BUNDLED_ROLES } from "../src/index.ts";

test("every bundled replacement manifest is well-formed and targets the shared role catalog", () => {
  for (const declaration of BUNDLED_DECLARATIONS) {
    const manifest =
      declaration.manifest === undefined
        ? undefined
        : ExtensionManifestSchema.parse(declaration.manifest);
    expect(
      replacementIssue(declaration.name, manifest, BUNDLED_ROLES),
      declaration.name,
    ).toBeNull();
  }
});
