import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { join } from "node:path";
import { KB_SDK_DTS, KB_SDK_PAGE_DTS, KB_SDK_VERSION } from "./sdk-dts.text.ts";

/** Each file `writeSdkDts` writes under `.kb/`: the module, and a page half's beside it. */
const SDK_FILES = [
  { file: "sdk.d.ts", text: KB_SDK_DTS },
  { file: "sdk-page.d.ts", text: KB_SDK_PAGE_DTS },
] as const;

/** Return the embedded SDK declaration text (matches this kb binary). */
export function readEmbeddedSdkDts(): string {
  return KB_SDK_DTS;
}

/**
 * Write `<root>/.kb/sdk.d.ts`, and `sdk-page.d.ts` for a page half, from the
 * embedded SDK strings. Creates `.kb/` when missing. Returns the server
 * module's path and the bytes written, with kb's version stamp.
 */
export const writeSdkDts = Effect.fn("kb.writeSdkDts")(function* (
  root: string,
): Effect.fn.Return<{ path: string; bytes: number; version: string }, PlatformError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(join(root, ".kb"), { recursive: true });
  for (const { file, text } of SDK_FILES) yield* fs.writeFileString(join(root, ".kb", file), text);
  return {
    path: join(root, ".kb", "sdk.d.ts"),
    bytes: SDK_FILES.reduce((total, { text }) => total + text.length, 0),
    version: KB_SDK_VERSION,
  };
});
