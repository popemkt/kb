export { decodeExtensionModule, decodeExtensionPlugin } from "./module.ts";
export { KB_SDK_DTS, KB_SDK_PAGE_DTS, KB_SDK_VERSION } from "./sdk-dts.text.ts";
/**
 * The two modules' types, as an author reads them: what each host's bridge
 * holds to the values it serves (`tests/surface-bridge.test.ts` for
 * `kb-ext-sdk`, `@kb/ui-sdk`'s `page-surface-bridge.test.ts` for
 * `kb-ext-sdk/page`).
 */
export type * as Surface from "./surface.ts";
export type * as PageSurface from "./page-surface.ts";
export type * as Bridge from "./bridge.ts";
