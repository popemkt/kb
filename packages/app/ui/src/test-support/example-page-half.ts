/**
 * The example repository extension's page half as the page imports it:
 * its bytes (`EXAMPLE_PAGE_HALF`, the closure's page half as a server
 * serves it, held to a fresh bundle by `@kb/test-kit`) served from a URL of
 * their own, through the page's own loader (`importPageHalf`), so a test
 * loads exactly what a trusted repository extension's page loads.
 */
import { Result } from "effect";
import type { ExtensionDeclaration } from "@kb/contracts";
import { decodeExtensionModule } from "@kb/ext-sdk";
import type { Plugin } from "@kb/plugin";
import { EXAMPLE_PAGE_HALF } from "./example-page.text";

/** Where the page imports `source` from: here, a URL holding the served bytes themselves. */
export function servedAt(source: string): string {
  const binary = Array.from(new TextEncoder().encode(source), (byte) =>
    String.fromCodePoint(byte),
  ).join("");
  return `data:text/javascript;base64,${btoa(binary)}`;
}

/** Where the example's page half is served. */
export const EXAMPLE_SERVED_AT = servedAt(EXAMPLE_PAGE_HALF);

/**
 * The example's page half, loaded as the page loads it, and the declaration
 * it exports beside its plugin: what its server half seeds, for a test that
 * folds the seed itself.
 */
export async function loadExamplePageHalf(): Promise<{
  readonly plugin: Plugin;
  readonly declaration: ExtensionDeclaration;
}> {
  // The page's loader is imported when first asked for, so importing this module starts nothing.
  const { importPageHalf } = await import("@/ui-plugins");
  const plugin = await importPageHalf(EXAMPLE_SERVED_AT, "example");
  // Its declaration decoded as discovery decodes a repository module's.
  const module: unknown = await import(/* @vite-ignore */ EXAMPLE_SERVED_AT);
  const decoded = decodeExtensionModule(module, "example");
  if (Result.isFailure(decoded)) throw new Error(`the example's page half: ${decoded.failure}`);
  return { plugin, declaration: decoded.success.declaration };
}
