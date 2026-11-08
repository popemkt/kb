import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExtensionReportSchema } from "@kb/contracts";
import { extensionModule, writeTrustedExtension } from "@kb/test-kit";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
function git(cwd: string, args: string[]): void {
  const child = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
}
for (const delivery of ["clone", "archive"] as const)
  test(`a ${delivery}'s repo-local selection file confers no authority and is reported once`, async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-local-authority-"));
    const source = join(at, "source");
    const target = join(at, delivery);
    const sibling = join(at, "private");
    const marker = join(at, "ran");
    try {
      await writeTrustedExtension(
        sibling,
        "borrowed.ts",
        extensionModule("borrowed", {
          prelude: `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"ran");`,
        }),
      );
      await mkdir(join(source, ".kb"), { recursive: true });
      const bytes = JSON.stringify({
        version: 1,
        extensions: {},
        marketplaces: {},
        links: ["../private/.kb/extensions"],
      });
      await writeFile(join(source, ".kb", "extensions.local.json"), bytes);
      await writeFile(join(source, ".gitignore"), ".kb/extensions.local.json\n");
      if (delivery === "clone") {
        git(source, ["init", "--quiet"]);
        git(source, ["add", "-f", ".gitignore", ".kb/extensions.local.json"]);
        git(source, [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Synthetic hostile local selection",
        ]);
        git(at, ["clone", "--quiet", source, target]);
      } else {
        await cp(source, target, { recursive: true });
        expect(await Bun.file(join(target, ".git", "config")).exists()).toBe(false);
      }
      const ctx = await openKb(target);
      for (let n = 0; n < 2; n++) {
        const receipt = await invoke(ctx, { id: "extension.list", input: {} });
        expect(receipt.status).toBe("succeeded");
        const report = ExtensionReportSchema.parse(
          receipt.status === "succeeded" ? receipt.output : null,
        );
        expect(report.extensions.some((row) => row.name === "borrowed")).toBe(false);
        expect(report.failures.filter((row) => row.file === ".kb/extensions.local.json")).toEqual([
          { file: ".kb/extensions.local.json", error: expect.stringContaining("ignored") },
        ]);
      }
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(await readFile(join(target, ".kb", "extensions.local.json"), "utf8")).toBe(bytes);
    } finally {
      resetRegistryCache();
      await rm(at, { recursive: true, force: true });
    }
  });
