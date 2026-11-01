// Renders the gallery starter's 3D pictures: `bun docs/research/assets/2026-10-31-3d-styles/render.ts [style…]`.
// It serves scene.js beside three from the workspace, renders each style in headless Chromium
// (software WebGL), and writes out/<style>.jpg. The pictures are made from code alone, so they are
// kb's own (CC0); packages/extension/gallery-net/src/starter-visuals.ts holds them as base64.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const here = import.meta.dir;
const root = join(here, "../../../..");
const { chromium } = await import(join(root, "packages/test-support/render-tests/node_modules/playwright/index.mjs"));
const three = dirname(dirname(Bun.resolveSync("three", join(root, "packages/app/ui"))));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    const file = path.startsWith("/three/") ? Bun.file(join(three, path.slice(7))) : Bun.file(join(here, path === "/" ? "index.html" : path.slice(1)));
    const type = path.endsWith(".js") ? "text/javascript" : "text/html";
    return new Response(file, { headers: { "content-type": type } });
  },
});
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 520, height: 400 } });
page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${server.port}/`);
await page.waitForFunction(() => (window as unknown as { kbReady?: boolean }).kbReady === true);
const asked = process.argv.slice(2);
const names: string[] = asked.length > 0 ? asked : await page.evaluate(() => (window as unknown as { kbStyles: string[] }).kbStyles);
mkdirSync(join(here, "out"), { recursive: true });
for (const name of names) {
  const url: string = await page.evaluate((n: string) => {
    document.body.innerHTML = "";
    return (window as unknown as { kbRender: (n: string) => string }).kbRender(n);
  }, name);
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  await Bun.write(join(here, "out", `${slug}.jpg`), Buffer.from(url.split(",")[1] ?? "", "base64"));
  console.log(slug);
}
await browser.close();
await server.stop();
