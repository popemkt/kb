import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { extensionClosure } from "../src/extension-closure.ts";
for (const contained of [false, true]) {
  for (const site of ["server", "page", "helper"] as const) {
    test(`compile never executes a ${site} macro (contained ${contained})`, async () => {
      const root = await mkdtemp(join(tmpdir(), "kb-build-safety-"));
      const marker = join(root, "ran");
      try {
        await mkdir(join(root, "hello"));
        await writeFile(
          join(root, "hello", "macro.ts"),
          `import {writeFileSync} from "node:fs";export function build(){writeFileSync(${JSON.stringify(marker)},"ran");return 42;}`,
        );
        const call =
          'import {build} from "./hello/macro.ts" with {type:"macro"}; export const answer=build();';
        await writeFile(
          join(root, "hello.ts"),
          site === "server"
            ? call
            : site === "helper"
              ? 'export {answer} from "./hello/helper.ts";'
              : "export const value=42;",
        );
        await writeFile(
          join(root, "hello.page.ts"),
          site === "page" ? call : "export const value=42;",
        );
        await writeFile(
          join(root, "hello", "helper.ts"),
          'import {build} from "./macro.ts" with {type:"macro"};export const answer=build();',
        );
        const result = await Effect.runPromise(
          extensionClosure(
            { dir: root, origin: "fixture", contained },
            join(root, "hello.ts"),
            join(root, "hello.page.ts"),
            null,
          ).pipe(Effect.result),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure).toContain("Macros are disabled");
        expect(await Bun.file(marker).exists()).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
