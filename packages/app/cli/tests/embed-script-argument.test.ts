/**
 * `kb ui --embed-script <url>`: each names a classic script a page an
 * `--embed-origin` frames loads for it; repeated, they collect. A script
 * with no origin to load it for is a usage error.
 */
import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { checkUiListen, collectScripts } from "../src/arguments.ts";

const BRIDGE = "https://bb.example/api/v1/plugins/bbim/http/bridge.js";

describe("--embed-script", () => {
  test("collects each script URL it is given, in order", () => {
    const first = collectScripts(BRIDGE);
    expect(collectScripts("http://localhost:3000/x.js", first)).toEqual([
      BRIDGE,
      "http://localhost:3000/x.js",
    ]);
  });

  test.each([
    "bridge.js",
    "/bridge.js",
    "javascript:alert(1)",
    "file:///tmp/x.js",
    "https://u:p@bb.example/x.js",
  ])("%s is a usage error", (value) => {
    expect(() => collectScripts(value)).toThrow(CommanderError);
  });

  test("is loaded only for pages some --embed-origin names", () => {
    expect(() => checkUiListen({ embedScript: [BRIDGE] })).toThrow(CommanderError);
    expect(() => checkUiListen({ embedScript: [BRIDGE], embedOrigin: [] })).toThrow(CommanderError);
    expect(() =>
      checkUiListen({ embedScript: [BRIDGE], embedOrigin: ["https://bb.example"] }),
    ).not.toThrow();
    expect(() => checkUiListen({ embedOrigin: ["https://bb.example"] })).not.toThrow();
  });
});
