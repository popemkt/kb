/**
 * The `kb ui` request guard (`src/guard.ts`) against a live server: another
 * site's page is refused at the `/ws` upgrade and at `/api/*`, a rebinding
 * `Host` is refused, a `text/plain` action is refused, and the UI's own page
 * and a local program without an Origin get through.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { startUi, type UiServerHandle } from "../src/index.ts";

const EVIL = "http://evil.example";

/** A GET with exactly these headers, Host included, which `fetch` will not let a caller set. */
function rawGet(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Whether a WebSocket handshake with this Origin opens (it answers hello) or is refused. */
function handshake(
  url: string,
  origin: string | undefined,
  host?: string,
): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws`, {
      headers: {
        ...(origin === undefined ? {} : { Origin: origin }),
        ...(host === undefined ? {} : { Host: host }),
      },
    });
    socket.addEventListener("open", () => {
      socket.close();
      resolve("open");
    });
    socket.addEventListener("error", () => resolve("refused"));
  });
}

describe("kb ui request guard", () => {
  let root: string;
  let handle: UiServerHandle;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-guard-"));
    handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
  });

  afterAll(async () => {
    await Effect.runPromise(handle.stop);
    await rm(root, { recursive: true, force: true });
  });

  test("a WebSocket upgrade from another site is refused; the UI's own page opens", async () => {
    expect(await handshake(handle.url, EVIL)).toBe("refused");
    expect(await handshake(handle.url, handle.url)).toBe("open");
    expect(await handshake(handle.url, `http://localhost:${new URL(handle.url).port}`)).toBe(
      "open",
    );
  });

  test("an API request from another site is refused", async () => {
    const res = await fetch(`${handle.url}/api/manifest`, { headers: { Origin: EVIL } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "failed", code: "forbidden" });
    // Nor may it learn which root this server serves.
    const identity = await fetch(`${handle.url}/api/identity`, { headers: { Origin: EVIL } });
    expect(identity.status).toBe(403);
  });

  test("a Host that is not this server is refused, which stops DNS rebinding", async () => {
    expect(
      await rawGet(`${handle.url}/api/manifest`, {
        Host: `evil.example:${new URL(handle.url).port}`,
      }),
    ).toBe(403);
    expect(
      await rawGet(`${handle.url}/ws`, { Host: `evil.example:${new URL(handle.url).port}` }),
    ).toBe(403);
    expect(
      await rawGet(`${handle.url}/api/manifest`, { Host: `localhost:${new URL(handle.url).port}` }),
    ).toBe(200);
  });

  test("a text/plain action, the POST a page may send without a preflight, is refused", async () => {
    const res = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ id: "kb.manifest", input: {} }),
    });
    expect(res.status).toBe(415);
  });

  test("the UI's own page and a local program without an Origin get through", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`${handle.url}/api/action`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
        body: JSON.stringify({ id: "kb.manifest", input: {} }),
      });
    expect((await post({ Origin: handle.url })).status).toBe(200);
    const cli = await post({});
    expect(cli.status).toBe(200);
    expect(await cli.json()).toMatchObject({ status: "succeeded", id: "kb.manifest" });
  });

  test("under `kb ui --dev`, the page's origin is the dev server's", async () => {
    const devRoot = await mkdtemp(join(tmpdir(), "kb-guard-dev-"));
    const dev = await Effect.runPromise(
      startUi({ root: devRoot, port: 0, openBrowser: false, uiPort: 5999 }),
    );
    try {
      const from = (origin: string) =>
        fetch(`${dev.url}/api/manifest`, { headers: { Origin: origin } }).then((r) => r.status);
      expect(await from("http://localhost:5999")).toBe(200);
      expect(await from("http://localhost:5998")).toBe(403);
    } finally {
      await Effect.runPromise(dev.stop);
      await rm(devRoot, { recursive: true, force: true });
    }
  });

  test("a declared reverse proxy origin reaches the API and WebSocket", async () => {
    const proxyRoot = await mkdtemp(join(tmpdir(), "kb-guard-proxy-"));
    const publicOrigin = "https://kb.example.test";
    const host = new URL(publicOrigin).host;
    const proxy = await Effect.runPromise(
      startUi({ root: proxyRoot, port: 0, openBrowser: false, publicOrigin: `${publicOrigin}/` }),
    );
    try {
      expect(await rawGet(`${handle.url}/api/manifest`, { Host: host })).toBe(403);
      expect(await rawGet(`${proxy.url}/api/manifest`, { Host: host, Origin: publicOrigin })).toBe(
        200,
      );
      expect(await rawGet(`${proxy.url}/api/identity`, { Host: host })).toBe(200);
      expect(await handshake(proxy.url, publicOrigin, host)).toBe("open");
      expect(await handshake(proxy.url, EVIL, host)).toBe("refused");
      expect(await rawGet(`${proxy.url}/api/manifest`, { Host: host, Origin: EVIL })).toBe(403);
      expect(
        await rawGet(`${proxy.url}/api/manifest`, {
          Host: host,
          Origin: "http://kb.example.test",
        }),
      ).toBe(403);
      expect(
        await rawGet(`${proxy.url}/api/manifest`, {
          Host: "evil.example",
          Origin: publicOrigin,
        }),
      ).toBe(403);
    } finally {
      await Effect.runPromise(proxy.stop);
      await rm(proxyRoot, { recursive: true, force: true });
    }
  });

  test("each declared alias origin is the page's, exactly as declared, and the public origin stays", async () => {
    const aliasRoot = await mkdtemp(join(tmpdir(), "kb-guard-alias-"));
    const publicOrigin = "https://kb.example.test";
    const alias = "https://kb.localhost";
    const second = "https://kb.lan.test:8443";
    const aliased = await Effect.runPromise(
      startUi({
        root: aliasRoot,
        port: 0,
        openBrowser: false,
        publicOrigin,
        aliasOrigins: [alias, `${second}/`],
      }),
    );
    try {
      const status = (host: string, origin?: string) =>
        rawGet(`${aliased.url}/api/manifest`, {
          Host: host,
          ...(origin === undefined ? {} : { Origin: origin }),
        });
      for (const origin of [publicOrigin, alias, second]) {
        const { host } = new URL(origin);
        expect(await status(host, origin)).toBe(200);
        expect(await handshake(aliased.url, origin, host)).toBe("open");
        expect(await handshake(aliased.url, EVIL, host)).toBe("refused");
        expect(await status(host, EVIL)).toBe(403);
      }
      // Scheme, port and name are matched exactly; no other localhost name is admitted.
      expect(await status("kb.localhost", "http://kb.localhost")).toBe(403);
      expect(await status("kb.localhost:8443", "https://kb.localhost:8443")).toBe(403);
      expect(await status("kb.lan.test", "https://kb.lan.test")).toBe(403);
      expect(await status("other.localhost", "https://other.localhost")).toBe(403);
      expect(await handshake(aliased.url, "https://other.localhost", "other.localhost")).toBe(
        "refused",
      );
      // An alias's Origin does not admit another Host.
      expect(await status("evil.example", alias)).toBe(403);
      // The page is still the listener's: an alias is never kb's address.
      const identity = (await (await fetch(`${aliased.url}/api/identity`)).json()) as {
        page: string;
      };
      expect(identity.page).toBe(aliased.url);
    } finally {
      await Effect.runPromise(aliased.stop);
      await rm(aliasRoot, { recursive: true, force: true });
    }
  });

  test("an alias origin needs no public origin, and admits nothing more than itself", async () => {
    const aliasRoot = await mkdtemp(join(tmpdir(), "kb-guard-alias-only-"));
    const alias = "https://kb.localhost";
    const aliased = await Effect.runPromise(
      startUi({ root: aliasRoot, port: 0, openBrowser: false, aliasOrigins: [alias] }),
    );
    try {
      expect(
        await rawGet(`${aliased.url}/api/manifest`, { Host: "kb.localhost", Origin: alias }),
      ).toBe(200);
      expect(await handshake(aliased.url, alias, "kb.localhost")).toBe("open");
      expect(
        await rawGet(`${aliased.url}/api/manifest`, {
          Host: "kb.example.test",
          Origin: "https://kb.example.test",
        }),
      ).toBe(403);
    } finally {
      await Effect.runPromise(aliased.stop);
      await rm(aliasRoot, { recursive: true, force: true });
    }
  });

  test("the rest of the site is not the API, and is not guarded", async () => {
    const res = await fetch(`${handle.url}/`, { headers: { Origin: EVIL } });
    expect(res.status).not.toBe(403);
  });

  test("the sandbox frame is served sandboxed, connecting nowhere, embeddable only here", async () => {
    const res = await fetch(`${handle.url}/sandbox`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toStartWith("sandbox allow-scripts;");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain('<script src="/sandbox/frame.js"></script>');
  });
});
