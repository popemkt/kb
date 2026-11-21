import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a timed-out wait stops polling and runner-owned cleanup completes before the next test", async () => {
  // Intentionally fail a test in a separate runner to exercise its real timeout.
  const root = await mkdtemp(join(tmpdir(), "kb-until-"));
  try {
    const fixture = join(root, "timeout.test.ts");
    await writeFile(
      fixture,
      `
import { expect, onTestFinished, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { until } from ${JSON.stringify(import.meta.resolve("../src/until.ts"))};

const marker = "owned-by-timed-out-test";
let polls = 0;
let stoppedAt = 0;
test("timed-out wait", async () => {
  writeFileSync(marker, "");
  const waiting = until(() => { polls += 1; return undefined; }, "a result that never arrives");
  onTestFinished(async () => {
    stoppedAt = polls;
    await rm(marker);
  });
  await waiting;
}, 50);

test("the next test owns its waits", async () => {
  expect(await Bun.file(marker).exists()).toBe(false);
  await Bun.sleep(50);
  expect(polls).toBe(stoppedAt);
});
`,
    );
    const runner = Bun.spawn([process.execPath, "test", fixture], {
      cwd: root,
      stderr: "pipe",
      stdout: "ignore",
    });
    const [code, output] = await Promise.all([runner.exited, new Response(runner.stderr).text()]);
    expect(code).toBe(1);
    expect(output).toContain("Still waiting for a result that never arrives");
    expect(output).toContain("(fail) timed-out wait");
    expect(output).toContain("(pass) the next test owns its waits");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
