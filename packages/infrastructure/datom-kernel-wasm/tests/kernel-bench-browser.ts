/**
 * EXPERIMENT benchmark in Chromium: bundle `kernel-bench.page.ts` for the
 * browser, serve it beside the store and the wasm, and print what the page
 * logs. Run: `bun tests/kernel-bench-browser.ts <root>/.kb/nodes.jsonl`.
 */
import { chromium } from "playwright";
import { DATOM_KERNEL_WASM_URL } from "../src/index.ts";

const built = await Bun.build({
  entrypoints: [new URL("./kernel-bench.page.ts", import.meta.url).pathname],
  target: "browser",
  minify: true,
});
const [output] = built.outputs;
if (output === undefined) throw new Error("the page bench did not build");
const script = await output.text();
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/nodes.jsonl") return new Response(Bun.file(process.argv[2] ?? ""));
    if (path === "/kernel.wasm") return new Response(Bun.file(DATOM_KERNEL_WASM_URL));
    if (path === "/bench.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    return new Response('<script type="module" src="/bench.js"></script>', {
      headers: { "content-type": "text/html" },
    });
  },
});
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
const done = Promise.withResolvers<void>();
page.on("console", (m) => (m.text() === "DONE" ? done.resolve() : console.log(m.text())));
page.on("pageerror", (e) => done.reject(e));
await page.goto(server.url.href);
await done.promise;
await browser.close();
await server.stop();
