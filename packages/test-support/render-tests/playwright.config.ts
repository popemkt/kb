import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "playwright/test";
import durations from "./render-durations.json" with { type: "json" };
import { renderShard } from "./render-shards.ts";

// Headless Chromium hides WebGPU behind `--enable-unsafe-webgpu`. With it, a
// machine that has an adapter proves the WebGPU path; one without falls back
// to WebGL2, and the specs read which (`gpu` in harness-test.ts). On Linux,
// Chromium reaches a real GPU (Mesa's radv, say) only through Vulkan, for
// WebGPU and for ANGLE's WebGL alike; without these it draws in SwiftShader
// even where a GPU is present. A Linux host with no GPU still falls back to
// SwiftShader. macOS needs none of them: Metal is the default there.
const isCI = process.env.CI !== undefined && process.env.CI !== "";

const chromiumGpuArgs = [
  "--enable-unsafe-webgpu",
  ...(process.platform === "linux" ? ["--enable-features=Vulkan", "--use-angle=vulkan"] : []),
];

/**
 * The specs that need the macOS runner (`macos` project); every other spec is
 * `portable` and CI may run it on Linux (docs/ci.md → Scheduling and
 * selection). A spec is listed because of what it reads there:
 * - the GPU: the backdrops and scenes, WebGPU where macOS has Metal and
 *   WebGL2 otherwise (`gpu` in harness-test.ts), a hundred of the suite's
 *   tests and most of its time;
 * - macOS's fonts, scrollbars and colour: `typography`, `region-scrollbar`,
 *   `design-system` and `gallery` measure what the platform lays out;
 * - a Linux runner without a GPU measured 5 to 8 times slower than macOS
 *   (`query-builder`, `view-settings`) or over its frame budget
 *   (`query-budget`), so they stay.
 * A new spec is portable until it is listed; a portable spec that fails on
 * Linux is listed with the reason, not retried.
 */
const MACOS_SPECS =
  /\/(backdrop-[^/]*|canvas3d[^/]*|design-system|gallery|head-band-contrast|lab|query-budget|query-builder|region-scrollbar|render|typography|unicorn-cold-start|view-settings)\.e2e\.ts$/;

// The portable project is the complement of macos.
const PROJECTS = [
  { name: "macos", testMatch: MACOS_SPECS },
  { name: "portable", testIgnore: MACOS_SPECS },
] as const;

const config = defineConfig({
  testDir: "./tests-render",
  testMatch: "**/*.e2e.ts",
  projects: [...PROJECTS],
  fullyParallel: true,
  // Why one on CI: docs/ci.md → Scheduling and selection.
  workers: isCI ? 1 : undefined,
  forbidOnly: isCI,
  // A retry would hide exactly the order and timing faults this suite exists
  // to surface; a flaky spec is fixed, never retried into green.
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  globalSetup: "./tests-render/global-setup.ts",
  use: {
    // Each test's `baseURL` is its own harness (`tests-render/harness-test.ts`).
    browserName: "chromium",
    // Chromium's new headless mode, not the headless shell: the shell hands
    // out a WebGPU adapter but cannot present to a canvas, so every WebGPU
    // scene stalls until its device is lost.
    channel: "chromium",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    // Playwright hides scrollbars in headless Chromium by default; kept, the
    // page lays out with classic scrollbars, as Chromium on Linux and Windows
    // does for a person, so a gutter a scroller keeps shows in every spec.
    launchOptions: { args: chromiumGpuArgs, ignoreDefaultArgs: ["--hide-scrollbars"] },
  },
});

const shard = process.env.KB_RENDER_SHARD;
if (shard !== undefined) {
  const { testDir, testMatch } = config;
  if (testDir === undefined || typeof testMatch !== "string") {
    throw new Error("Render sharding requires the suite's testDir and testMatch glob");
  }
  const cwd = fileURLToPath(new URL(testDir, import.meta.url));
  const files = globSync(testMatch, { cwd }).filter((file) => !file.startsWith("node_modules/"));
  config.projects = PROJECTS.map((project) => {
    const projectFiles = files.filter((file) =>
      "testMatch" in project
        ? project.testMatch.test(`/${file}`)
        : !project.testIgnore.test(`/${file}`),
    );
    return {
      ...project,
      testMatch: renderShard(projectFiles, durations[project.name], shard).map(
        (file) => new RegExp(`/${RegExp.escape(file)}$`),
      ),
    };
  });
}

export default config;
