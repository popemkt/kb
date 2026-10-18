/**
 * `kb docs check`, `kb docs materialize` and `kb check audit` over a scratch
 * root: each prints what its action answers, and a check exits by its answer
 * — 1 when the report is not clean, even though the action succeeded — since
 * a hook or CI step reads the exit code. The actions' own promises are
 * `@kb/ext-docs`' and `@kb/ext-check`'s tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDocsView, pointHomeAt } from "@kb/test-kit";
import { main } from "../src/cli.ts";

let scratch: string;
let root: string;
let restoreHome: () => void;

async function kb(args: string[]): Promise<{ code: number; stdout: string }> {
  const stdout: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  process.stderr.write = () => true;
  try {
    process.exitCode = 0;
    const code = await main(["bun", "kb", "--root", root, ...args]);
    return { code, stdout: stdout.join("") };
  } finally {
    process.stdout.write = write;
    process.stderr.write = errWrite;
  }
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "kb-cli-gates-")));
  restoreHome = pointHomeAt(join(scratch, "home"));
  root = join(scratch, "root");
  await mkdir(root);
  expect((await kb(["init", "--bare"])).code).toBe(0);
});

afterEach(async () => {
  restoreHome();
  process.exitCode = 0;
  await rm(scratch, { recursive: true, force: true });
});

describe("kb docs", () => {
  test("check is 1 while a view's doc is missing, and 0 once materialize wrote it", async () => {
    await Effect.runPromise(
      addDocsView(root, "todos", {
        output: "docs/todos.md",
        query:
          '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?n :node/id ?id]]',
        template: "todos",
      }),
    );

    const stale = await kb(["docs", "check"]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain("kb docs: missing — docs/todos.md (view: todos)");

    const written = await kb(["docs", "materialize"]);
    expect(written.code).toBe(0);
    expect(written.stdout).toContain("kb docs: wrote docs/todos.md (view: todos)");

    const clean = await kb(["docs", "check"]);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("kb docs: clean (1 view)");
  });

  test("--json prints the action's report and still exits by its answer", async () => {
    await Effect.runPromise(
      addDocsView(root, "todos", {
        output: "docs/todos.md",
        query: "[:find ?id :where [?n :node/id ?id]]",
        template: "todos",
      }),
    );
    const stale = await kb(["--json", "docs", "check"]);
    expect(stale.code).toBe(1);
    expect(JSON.parse(stale.stdout)).toMatchObject({
      status: "succeeded",
      output: { clean: false },
    });
  });
});

describe("kb check audit", () => {
  test("a store with no rules and no checks is clean", async () => {
    const out = await kb(["check", "audit"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("kb checks: clean");
  });

  test("a rule whose home does not resolve is a finding, and exits 1", async () => {
    await writeFile(join(root, "RULES.md"), "# Rules\n\n## Kept\n");
    expect((await kb(["tag", "define", "rule"])).code).toBe(0);
    expect(
      (
        await kb([
          "add",
          "Broken home",
          "--tag",
          "rule",
          "--create",
          "--prop",
          "home=RULES.md#missing",
        ])
      ).code,
    ).toBe(0);
    const out = await kb(["check", "audit"]);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain("home-broken");
  });
});

// Built, not written out: this file is scanned too.
const mark = (id: string) => ["GAP ", "[[", id, "]]"].join("");

describe("kb check gaps", () => {
  test("an empty file list fails: a scan of nothing is no pass", async () => {
    expect((await kb(["check", "gaps"])).code).toBe(1);
  });

  test("lists come from arguments and --files-from, NUL-separated", async () => {
    expect((await kb(["tag", "define", "gap"])).code).toBe(0);
    expect((await kb(["add", "GAP: deferred", "--tag", "gap", "--id", "g.open"])).code).toBe(0);
    await writeFile(join(root, "a.ts"), `// ${mark("g.open")}\n`);
    await writeFile(join(root, "b.ts"), `// ${mark("g.absent")}\n`);
    await writeFile(join(scratch, "list"), "a.ts\0");

    const clean = await kb(["check", "gaps", "--files-from", join(scratch, "list")]);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("kb gaps: clean (1 marker(s) in 1 file(s))");

    const red = await kb(["check", "gaps", "b.ts", "--files-from", join(scratch, "list")]);
    expect(red.code).toBe(1);
    expect(red.stdout).toContain("gap-missing — b.ts:1:");
  });
});
