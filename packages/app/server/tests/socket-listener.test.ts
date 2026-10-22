/**
 * `kb ui` on a Unix socket (`src/listener.ts`, DESIGN.md → Surfaces → Hosted
 * behind a proxy): the socket is created with mode 0600, so only its owner
 * (and root, as `tailscale serve` runs) can connect; a request through it
 * names `localhost`, as the proxy rewrites `Host`, and the page is the
 * proxy's public origin, which works as a page served any other way does,
 * named by the identity header the proxy sets where it sets one. A
 * stale socket is replaced, a live one (whatever listens on it) or a file
 * that is no socket is refused, and the socket is gone once the server stops.
 * Its presence names the socket, so a process on this machine reaches it
 * there, as a local program (`requestUi`, `servingUi`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Effect, Exit } from "effect";
import { bunFileSystemLayer } from "@kb/runtime";
import { requestUi, servingUi } from "@kb/workspace-fs";
import { identityHeaderIdentity, startUi, type UiServerHandle } from "../src/index.ts";

const HEADER = "Tailscale-User-Login";
const OWNER = "owner@example.com";
const PUBLIC = "https://kb.tailnet.ts.net";

let dir = "";
let root = "";
let path = "";
let handle: UiServerHandle;

/** The socket server for `root` at `socket`, believing the proxy's header. */
function serve(socket: string, at = root) {
  return startUi({
    root: at,
    socket,
    publicOrigin: PUBLIC,
    openBrowser: false,
    identity: [identityHeaderIdentity({ header: HEADER, people: [OWNER] })],
  });
}

/** A request through the socket, as the proxy sends one: `Host: localhost` unless told otherwise. */
function viaSocket(route: string, init: RequestInit = {}) {
  return fetch(`http://localhost${route}`, { ...init, unix: path });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kb-socket-"));
  root = join(dir, "root");
  path = join(dir, "kb.sock");
  await mkdir(root);
  handle = await Effect.runPromise(serve(path));
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(dir, { recursive: true, force: true });
});

describe("kb ui on a Unix socket", () => {
  test("the socket is its owner's alone, and the page is the proxy's", async () => {
    const info = await stat(path);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
    expect(handle.at).toEqual({ kind: "socket", path, origin: PUBLIC });
    expect(handle.url).toBe(PUBLIC);
  });

  test("the proxy's localhost and its public host are this server; another host is not", async () => {
    expect((await viaSocket("/api/manifest")).status).toBe(200);
    const proxied = await viaSocket("/api/manifest", {
      headers: { Host: new URL(PUBLIC).host, Origin: PUBLIC },
    });
    expect(proxied.status).toBe(200);
    expect((await viaSocket("/api/manifest", { headers: { Host: "evil.example" } })).status).toBe(
      403,
    );
  });

  test("its presence names the socket, and a process on this machine reaches it there", async () => {
    const file = join(root, ".kb", "ui.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      at: { kind: "socket", path, origin: PUBLIC },
      pid: process.pid,
      root: await realpath(root),
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const served = await Effect.runPromise(
      servingUi(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(served).toEqual(handle.at);
  });

  test("the server says where its page is, and presence naming its socket with another page is no server", async () => {
    const identity: unknown = await (await requestUi(handle.at, "/api/identity")).json();
    expect(identity).toEqual({ root: await realpath(root), page: PUBLIC });
    const file = join(root, ".kb", "ui.json");
    const written = await readFile(file, "utf8");
    try {
      const forged = { ...handle.at, origin: "https://attacker.example" };
      await writeFile(file, JSON.stringify({ ...JSON.parse(written), at: forged }));
      const served = await Effect.runPromise(
        servingUi(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(served).toBeNull();
    } finally {
      await writeFile(file, written);
    }
  });

  test("a request through the socket without the page's Origin is a local program's, nobody's", async () => {
    // Whom `/ws` says the connection is: the guard's caller for the request.
    const personOf = async (headers: Record<string, string>) => {
      const ws = new WebSocket(`ws+unix://${path}:/ws`, { headers });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          ws.addEventListener("error", () => reject(new Error("refused")));
          ws.addEventListener("message", (event) => {
            const msg = JSON.parse(String(event.data)) as { op: string; person?: unknown };
            if (msg.op === "person") resolve(msg.person);
          });
        });
      } finally {
        ws.close();
      }
    };
    // The proxy's header does not make a program the person: only the page's Origin does.
    expect(await personOf({ [HEADER]: OWNER })).toBeNull();
    expect(await personOf({ [HEADER]: OWNER, Origin: PUBLIC })).toEqual({ name: OWNER });
    // And presence's own request is a program's, which the API answers.
    const listed = (await (await requestUi(handle.at, "/api/manifest")).json()) as unknown[];
    expect(listed.length).toBeGreaterThan(0);
  });

  test("a page on localhost is no origin of a socket's", async () => {
    const res = await viaSocket("/api/manifest", { headers: { Origin: "http://localhost" } });
    expect(res.status).toBe(403);
  });

  test("its page works with or without the header its proxy sets, as on every deployment", async () => {
    const edit = async (headers: Record<string, string>) => {
      const res = await viaSocket("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: PUBLIC, ...headers },
        body: JSON.stringify({ id: "node.add", input: { text: "mine" } }),
      });
      return { status: res.status, body: (await res.json()) as { status: string } };
    };
    const headerSets: Record<string, string>[] = [
      { [HEADER]: OWNER },
      { [HEADER]: "someone@example.com" },
      {},
    ];
    for (const headers of headerSets) {
      expect(await edit(headers)).toEqual({
        status: 200,
        body: expect.objectContaining({ status: "succeeded" }),
      });
    }
  });
});

describe("claiming the socket path", () => {
  test("a stale socket is replaced, and the socket is gone once the server stops", async () => {
    const stale = join(dir, "stale.sock");
    // A server killed outright leaves its socket behind; one that closes removes it.
    const killed = Bun.spawn([
      process.execPath,
      "-e",
      `require("node:net").createServer().listen(${JSON.stringify(stale)}, () => process.kill(process.pid, "SIGKILL"))`,
    ]);
    await killed.exited;
    expect((await stat(stale)).isSocket()).toBe(true);
    const kept = await mkdtemp(join(dir, "root-"));
    const again = await Effect.runPromise(serve(stale, kept));
    expect((await stat(stale)).isSocket()).toBe(true);
    await Effect.runPromise(again.stop);
    expect(await Bun.file(stale).exists()).toBe(false);
  });

  test("a socket named by a relative path is present by its absolute one, until the server stops", async () => {
    const absolute = join(dir, "relative.sock");
    const other = await mkdtemp(join(dir, "root-"));
    const served = await Effect.runPromise(serve(relative(process.cwd(), absolute), other));
    const file = join(other, ".kb", "ui.json");
    try {
      expect(served.at).toEqual({ kind: "socket", path: absolute, origin: PUBLIC });
      const presence = JSON.parse(await readFile(file, "utf8")) as { at: unknown };
      expect(presence.at).toEqual(served.at);
    } finally {
      await Effect.runPromise(served.stop);
    }
    expect(await Bun.file(file).exists()).toBe(false);
    expect(await Bun.file(absolute).exists()).toBe(false);
  });

  test("a socket a live server answers on is refused", async () => {
    const other = await mkdtemp(join(dir, "root-"));
    const exit = await Effect.runPromiseExit(serve(path, other));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("already listens");
  });

  test("a socket a live listener accepts on is refused, whatever it speaks", async () => {
    const mute = join(dir, "mute.sock");
    // A listener that is no HTTP server: it accepts, then hangs up at once.
    const listener = Bun.listen({
      unix: mute,
      socket: {
        open: (socket) => void socket.end(),
        data: () => {},
      },
    });
    try {
      const other = await mkdtemp(join(dir, "root-"));
      const exit = await Effect.runPromiseExit(serve(mute, other));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(String(exit)).toContain("already listens");
      expect((await stat(mute)).isSocket()).toBe(true);
    } finally {
      listener.stop(true);
    }
  });

  test("a path that is no socket is refused, and left as it was", async () => {
    const file = join(dir, "not-a-socket");
    await writeFile(file, "keep me");
    const other = await mkdtemp(join(dir, "root-"));
    const exit = await Effect.runPromiseExit(serve(file, other));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("is not a socket");
    expect(await Bun.file(file).text()).toBe("keep me");
  });

  test("a socket needs the public origin its proxy serves it at", async () => {
    const other = await mkdtemp(join(dir, "root-"));
    const exit = await Effect.runPromiseExit(
      startUi({ root: other, socket: join(dir, "x.sock"), openBrowser: false }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("public origin");
  });
});
