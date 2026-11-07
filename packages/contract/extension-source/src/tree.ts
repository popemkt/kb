import { Effect } from "effect";
import {
  SOURCE_LIMITS,
  SourceError,
  sourcePath,
  type SourceFile,
  type SourceTree,
  type SelectedSource,
} from "./model.ts";

export interface ObjectFile {
  readonly path: string;
  readonly mode: string;
  readonly bytes: Uint8Array;
}
export function checkSourceEntries(
  objects: readonly { readonly path: string; readonly mode: string }[],
): void {
  if (objects.length > SOURCE_LIMITS.files)
    throw new SourceError({ message: "source has too many files" });
  const prefixes = new Map<string, { path: string; file: boolean }>();
  for (const file of objects) {
    if (file.mode !== "100644" && file.mode !== "100755")
      throw new SourceError({ message: `source is not a regular file: ${file.path}` });
    if (!sourcePath.safeParse(file.path).success || file.path === "")
      throw new SourceError({ message: `unsafe source path: ${file.path}` });
    const parts = file.path.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const path = parts.slice(0, count).join("/");
      const alias = path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
      const held = prefixes.get(alias);
      const terminal = count === parts.length;
      if (held !== undefined && (held.path !== path || held.file || terminal))
        throw new SourceError({ message: `source path collision: ${file.path}` });
      prefixes.set(alias, { path, file: terminal });
    }
  }
}

/** Every transport supplies exactly this checked raw file set. Layout parsing is a projection. */
function regularFiles(objects: readonly ObjectFile[]): SourceFile[] {
  checkSourceEntries(objects);
  let bytes = 0;
  for (const file of objects) {
    bytes += file.bytes.length;
    if (bytes > SOURCE_LIMITS.bytes)
      throw new SourceError({ message: "source exceeds byte limit" });
  }
  return objects
    .map<SourceFile>((file) => ({ ...file, mode: file.mode === "100755" ? "100755" : "100644" }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function selectedFiles(objects: readonly SourceFile[]): Omit<SelectedSource, "hash"> {
  const servers = objects.filter(
    ({ path }) => /^[\w][\w.-]*\.ts$/.test(path) && !/\.d\.ts$|\.page\.ts$/.test(path),
  );
  if (servers.length !== 1)
    throw new SourceError({
      message: `source needs exactly one server entry; install a subfolder: ${servers.map(({ path }) => path).join(", ")}`,
    });
  const name = servers[0]?.path.slice(0, -3) ?? "";
  const files: SourceFile[] = [];
  const ignored: string[] = [];
  for (const file of objects) {
    if (
      file.path === `${name}.ts` ||
      file.path === `${name}.page.ts` ||
      file.path === `${name}.page.tsx` ||
      file.path.startsWith(`${name}/`) ||
      file.path === "README.md" ||
      /^LICENSE[^/]*$/.test(file.path)
    ) {
      files.push(file);
    } else ignored.push(file.path);
  }
  return { name, files, ignored: ignored.toSorted() };
}

export const checkedTree = Effect.fn("source.checkedTree")(function* (
  objects: readonly ObjectFile[],
) {
  const selected = yield* Effect.try({
    try: () => regularFiles(objects),
    catch: SourceError.from,
  });
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode("kb.source/1\0")];
  for (const file of selected) {
    for (const part of [encoder.encode(file.path), encoder.encode(file.mode), file.bytes])
      chunks.push(encoder.encode(`${part.length}:`), part);
  }
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes));
  return {
    files: selected,
    hash: `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  };
});

/** Select the extension layout once, after the raw source satisfies the transport contract. */
export const extensionTree = Effect.fn("source.extensionTree")(function* (tree: SourceTree) {
  const selected = yield* Effect.try({
    try: () => selectedFiles(tree.files),
    catch: SourceError.from,
  });
  return { ...selected, ...(yield* checkedTree(selected.files)) };
});
export const checkedExtensionTree = Effect.fn("source.checkedExtensionTree")(function* (
  objects: readonly ObjectFile[],
) {
  return yield* extensionTree(yield* checkedTree(objects));
});
