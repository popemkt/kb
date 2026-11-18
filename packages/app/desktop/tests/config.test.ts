/** The desktop's own settings and window state: defaults, malformed input, and a round trip. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, DesktopConfig, desktopDir, settingsOf } from "../src/index.ts";

describe("desktopDir", () => {
  test("KB_DESKTOP_HOME wins, then the platform's place", () => {
    expect(desktopDir({ KB_DESKTOP_HOME: "/x" }, "darwin", "/Users/a")).toBe("/x");
    expect(desktopDir({}, "darwin", "/Users/a")).toBe(
      "/Users/a/Library/Application Support/kb-desktop",
    );
    expect(desktopDir({ XDG_CONFIG_HOME: "/c" }, "linux", "/home/a")).toBe("/c/kb-desktop");
    expect(desktopDir({}, "linux", "/home/a")).toBe("/home/a/.config/kb-desktop");
  });
});

describe("settingsOf", () => {
  test("nothing, or nonsense, is the defaults", () => {
    expect(settingsOf(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf({ hotkey: 3, remotes: "no", stopStartedHostsOnQuit: "yes" })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  test("keeps what is well formed and drops a malformed remote", () => {
    const settings = settingsOf({
      kb: "/opt/kb/bin/kb",
      hotkey: "Alt+Space",
      remotes: [{ key: "r1", name: "Work", origin: "https://w.ts.net", token: "t" }, { key: "r2" }],
    });
    expect(settings.kb).toBe("/opt/kb/bin/kb");
    expect(settings.hotkey).toBe("Alt+Space");
    expect(settings.remotes).toEqual([
      { key: "r1", name: "Work", origin: "https://w.ts.net", token: "t" },
    ]);
  });
});

describe("DesktopConfig", () => {
  test("window memory survives a restart; a window not open stays closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-desktop-config-"));
    const first = new DesktopConfig(dir);
    first.rememberWindow("a", { frame: { x: 1, y: 2, width: 900, height: 700 }, open: true });
    first.rememberWindow("a", { path: "/node/x" });
    first.rememberWindow("b", { frame: { x: 0, y: 0, width: 800, height: 600 }, open: false });
    first.rememberWindow("never-framed", { open: true });
    const second = new DesktopConfig(dir);
    expect(second.window("a")).toEqual({
      frame: { x: 1, y: 2, width: 900, height: 700 },
      open: true,
      path: "/node/x",
    });
    expect(second.openWindows()).toEqual(["a"]);
  });

  test("a corrupt file reads as nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-desktop-config-"));
    writeFileSync(join(dir, "settings.json"), "{not json");
    writeFileSync(join(dir, "windows.json"), JSON.stringify({ a: { frame: { x: 0 } } }));
    const config = new DesktopConfig(dir);
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
    expect(config.window("a")).toBeUndefined();
  });
});
