import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIGEST = `sha256:${"b".repeat(64)}`;

test("CLI trust rejects JSON approval without a terminal and accepts only a terminal yes", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "kb-cli-approval-"));
  // child inherits the toolchain and receives isolated stores
  const env = { ...process.env, KB_HOME: join(scratch, "home"), KB_DATA: join(scratch, "data") };
  const cmd = [
    process.execPath,
    join(import.meta.dir, "../src/main.ts"),
    "--root",
    scratch,
    "--json",
    "action-invoke",
    JSON.stringify({
      id: "sandbox.trust",
      input: { digest: DIGEST, force: true },
      approved: true,
      actor: "human",
    }),
  ];
  try {
    for (const mode of ["required", "off"]) {
      for (const via of ["argument", "stdin"]) {
        const args = [...cmd.slice(0, 2), "--governance", mode, ...cmd.slice(2)];
        if (via === "stdin") args[args.length - 1] = "-";
        const refused = Bun.spawn(args, {
          env,
          detached: true,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        });
        await refused.stdin.write(via === "stdin" ? (cmd[cmd.length - 1] ?? "") : "y\n");
        await refused.stdin.end();
        expect(JSON.parse(await new Response(refused.stdout).text())).toMatchObject({
          status: "failed",
          code: "approval_required",
        });
        expect(await refused.exited).toBe(1);
      }
    }
    for (const answer of ["n", "yes"]) {
      let output = "";
      let answered = false;
      const child = Bun.spawn(cmd, {
        env,
        terminal: {
          cols: 120,
          rows: 30,
          data(terminal, bytes) {
            output += new TextDecoder().decode(bytes);
            if (!answered && output.includes("[y/N]")) {
              answered = true;
              terminal.write(`${answer}\n`);
            }
          },
        },
      });
      try {
        expect(await child.exited).toBe(answer === "yes" ? 0 : 1);
        expect(answered).toBe(true);
        expect(output).toContain(
          answer === "yes" ? '"status": "succeeded"' : '"approval_required"',
        );
      } finally {
        child.kill();
        child.terminal?.close();
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
