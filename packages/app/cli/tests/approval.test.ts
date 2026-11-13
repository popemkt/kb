import { KB_SOURCE_BIN } from "@kb/test-kit";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

const DIGEST = `sha256:${"b".repeat(64)}`;

test("CLI trust rejects JSON approval without a terminal and accepts only a terminal yes", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "kb-cli-approval-"));
  // child inherits the toolchain and receives isolated stores
  const env = { ...process.env, KB_HOME: join(scratch, "home"), KB_DATA: join(scratch, "data") };
  const cmd = [
    KB_SOURCE_BIN,
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
        const args = [...cmd.slice(0, 1), "--governance", mode, ...cmd.slice(1)];
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

test("kb trust import needs a terminal and imports only the displayed machine's digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-import-"));
  const other = `sha256:${"c".repeat(64)}`;
  const env = { ...process.env, KB_HOME: join(root, "home"), KB_DATA: join(root, "data") };
  const legacy = join(root, ".kb", "trust.json");
  const body = JSON.stringify({
    version: 1,
    trusted: [
      { digest: DIGEST, machine: hostname(), at: "2026-11-07T00:00:00Z" },
      { digest: other, machine: "other-machine", at: "2026-11-07T00:00:00Z" },
    ],
  });
  const cmd = [KB_SOURCE_BIN, "--json", "trust", "import", root];
  try {
    await mkdir(join(root, ".kb"));
    const empty = Bun.spawn(cmd, {
      env,
      detached: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(await new Response(empty.stdout).text())).toMatchObject({
      status: "succeeded",
      output: { imported: [] },
    });
    expect(await empty.exited).toBe(0);
    expect(await Bun.file(join(root, "data", "trust.json")).exists()).toBe(false);
    await writeFile(legacy, body);
    const refused = Bun.spawn(cmd, {
      env,
      detached: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(await new Response(refused.stdout).text())).toMatchObject({
      status: "failed",
      code: "approval_required",
    });
    expect(await refused.exited).toBe(1);
    expect(await Bun.file(join(root, "data", "trust.json")).exists()).toBe(false);
    let output = "";
    let answered = false;
    const accepted = Bun.spawn(cmd, {
      env,
      terminal: {
        cols: 120,
        rows: 30,
        data(terminal, bytes) {
          output += new TextDecoder().decode(bytes);
          if (!answered && output.includes("[y/N]")) {
            answered = true;
            terminal.write("y\n");
          }
        },
      },
    });
    try {
      expect(await accepted.exited).toBe(0);
      expect(answered).toBe(true);
      expect(output).toContain(DIGEST);
      expect(output).not.toContain(other);
      const record = JSON.parse(await readFile(join(root, "data", "trust.json"), "utf8")) as {
        trusted: { digest: string }[];
      };
      expect(record.trusted.map(({ digest }) => digest)).toEqual([DIGEST]);
      expect(await readFile(legacy, "utf8")).toBe(body);
    } finally {
      accepted.kill();
      accepted.terminal?.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kb ext trust prints the compiled review and uses the terminal approval edge", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-ext-trust-"));
  const env = { ...process.env, KB_HOME: join(root, "home"), KB_DATA: join(root, "data") };
  const cmd = [KB_SOURCE_BIN, "--root", root, "--json", "ext", "trust", "hello"];
  try {
    await mkdir(join(root, ".kb", "extensions"), { recursive: true });
    await writeFile(
      join(root, ".kb", "extensions", "hello.ts"),
      'import {defineExtension} from "kb-ext-sdk";export const declaration=defineExtension({name:"hello",label:"Hello"});',
    );
    const refused = Bun.spawn(cmd, {
      env,
      detached: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, review] = await Promise.all([
      new Response(refused.stdout).text(),
      new Response(refused.stderr).text(),
    ]);
    expect(await refused.exited).toBe(1);
    expect(JSON.parse(out)).toMatchObject({ status: "failed", code: "approval_required" });
    expect(review).toContain('"reach"');
    expect(review).toContain('"hello.ts"');
    expect(await Bun.file(join(root, "data", "trust.json")).exists()).toBe(false);
    let output = "";
    let answered = false;
    const approved = Bun.spawn(cmd, {
      env,
      terminal: {
        cols: 120,
        rows: 30,
        data(terminal, bytes) {
          output += new TextDecoder().decode(bytes);
          if (!answered && output.includes("[y/N]")) {
            answered = true;
            terminal.write("y\n");
          }
        },
      },
    });
    try {
      expect(await approved.exited).toBe(0);
      expect(answered).toBe(true);
      expect(output).toContain('"trusted": true');
    } finally {
      approved.kill();
      approved.terminal?.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
