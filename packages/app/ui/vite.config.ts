import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

// `kb ui --dev` spawns `vp dev` and sets KB_UI_API_PORT to the backend port;
// KB_UI_DEV_PORT overrides the Vite listen port. Defaults match the CLI.
const apiPort = process.env.KB_UI_API_PORT ?? "4321";
const devPort = Number(process.env.KB_UI_DEV_PORT ?? 5173);

/**
 * A design system's sheet ships as a string in the page's script (a `?raw`
 * import the painter mounts), where no CSS minifier reaches it: its comments
 * and the whitespace no rule needs are dropped here, so the eager budget
 * pays for its rules alone (DESIGN-UI.md → Delivery). No sheet puts a
 * `{};`, `: ` or `0.` inside a string, where it would matter; a leading
 * zero (`0.5`) is dropped too.
 */
function compactRawSheets(): Plugin {
  return {
    name: "kb:compact-raw-sheets",
    enforce: "post",
    transform(code, id) {
      if (!/\/design-systems\/[^/]+\.css\?raw$/.test(id)) return null;
      const match = /^export default (".*");?\s*$/s.exec(code);
      if (match?.[1] === undefined) return null;
      const sheet: unknown = JSON.parse(match[1]);
      if (typeof sheet !== "string") return null;
      const compact = sheet
        .replaceAll(/\/\*[\s\S]*?\*\//g, "")
        .replaceAll(/\s+/g, " ")
        .replaceAll(/ ?([{};]) ?/g, "$1")
        .replaceAll(/: /g, ":")
        .replaceAll(/(?<![\w.])0\.(?=\d)/g, ".")
        .trim();
      return { code: `export default ${JSON.stringify(compact)};`, map: null };
    },
  };
}

export default defineConfig({
  // Own lint/check block is required: without it, `vp` walks up to
  // the root vite.config.ts and inherits `lint.ignorePatterns: ["ui/**"]`,
  // so `npm run lint` / `npm run check` find zero files.
  lint: {
    ignorePatterns: ["dist/**", "storybook-static/**", "**/node_modules/**"],
    options: {
      // Authoritative typecheck remains `tsc --noEmit` (`npm run typecheck`).
      typeCheck: false,
      typeAware: false,
    },
  },
  check: {
    // Prefer explicit `--no-fmt` in scripts; keep fmt off by default here too.
    fmt: false,
  },
  plugins: [tailwindcss(), react(), compactRawSheets()],
  build: {
    // `/assets/*` is the kb media route (.kb/assets) on the server; keep the
    // bundler's hashed output out of that namespace or index.html 404s. The
    // server keeps every file under it for good (DESIGN-UI.md → Delivery),
    // so whatever is written here must be named by its digest.
    assetsDir: "static",
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  server: {
    port: devPort,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/assets": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      // The sandbox frame's document and script come from the backend, which
      // serves the frame with its policy (DESIGN.md → Sandbox → The frame).
      "/sandbox": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-support/setup.ts"],
    // A design system's sheet is imported as text (`?raw`) and is what the
    // design-system contract reads, so the runner keeps raw CSS imports as
    // the build does rather than blanking them as it blanks stylesheets.
    css: { include: [/\.css\?raw$/] },
  },
});
