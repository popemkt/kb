/**
 * The platform keychain over a stand-in helper: what it asks on each
 * platform, a value on stdin and never on the command line, an item that is
 * not set read as null, and an ask that never answers given up.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { platformKeychain, type LookupResult, type RunLookup } from "../src/index.ts";

function recorder(answer: LookupResult) {
  const asked: { argv: readonly string[]; stdin: string | undefined }[] = [];
  const run: RunLookup = (argv, _signal, stdin) => {
    asked.push({ argv, stdin });
    return Promise.resolve(answer);
  };
  return { asked, run };
}

const item = { service: "kb-desktop", account: "remote-1" };

describe("platformKeychain", () => {
  test("reads, writes and erases with security on macOS, the value on stdin", async () => {
    const { asked, run } = recorder({ code: 0, stdout: "tok\n", stderr: "" });
    const keychain = platformKeychain({ platform: "darwin", run });
    expect(await Effect.runPromise(keychain.read(item))).toBe("tok");
    await Effect.runPromise(keychain.write(item, "kbd_secret"));
    await Effect.runPromise(keychain.erase(item));
    expect(asked).toEqual([
      {
        argv: ["security", "find-generic-password", "-s", "kb-desktop", "-a", "remote-1", "-w"],
        stdin: undefined,
      },
      {
        argv: ["security", "-i"],
        stdin: 'add-generic-password -U -s "kb-desktop" -a "remote-1" -w "kbd_secret"\n',
      },
      {
        argv: ["security", "delete-generic-password", "-s", "kb-desktop", "-a", "remote-1"],
        stdin: undefined,
      },
    ]);
    expect(asked.flatMap((each) => each.argv).join(" ")).not.toContain("kbd_secret");
  });

  test("uses secret-tool on Linux", async () => {
    const { asked, run } = recorder({ code: 0, stdout: "", stderr: "" });
    const keychain = platformKeychain({ platform: "linux", run });
    await Effect.runPromise(keychain.write(item, "v"));
    await Effect.runPromise(keychain.erase(item));
    expect(asked.map((each) => each.argv[1])).toEqual(["store", "clear"]);
    expect(asked[0]?.stdin).toBe("v");
  });

  test("an item that is not set reads as null", async () => {
    const { run } = recorder({ code: 44, stdout: "", stderr: "" });
    expect(await Effect.runPromise(platformKeychain({ platform: "darwin", run }).read(item))).toBe(
      null,
    );
  });

  test("macOS erase accepts an absent item and reports deletion or search failures", async () => {
    const missing =
      "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n";
    const erase = (code: number, stderr: string) =>
      Effect.runPromise(
        Effect.result(
          platformKeychain({
            platform: "darwin",
            run: recorder({ code, stdout: "", stderr }).run,
          }).erase(item),
        ),
      );
    expect(await erase(44, missing)).toMatchObject({ success: undefined });
    expect(
      await erase(44, `security: SecKeychainSearchCreateFromAttributes: No keychain\n${missing}`),
    ).toMatchObject({ failure: { message: "security refused to delete the item" } });
    expect(await erase(36, "password has been deleted.\n")).toMatchObject({
      failure: { message: "security refused to delete the item" },
    });
  });

  test("Linux erase confirms a silent clear found no matching item, including locked matches", async () => {
    const erase = (found: LookupResult) =>
      Effect.runPromise(
        Effect.result(
          platformKeychain({
            platform: "linux",
            run: (argv) => {
              if (argv[1] === "clear") return Promise.resolve({ code: 1, stdout: "", stderr: "" });
              expect(argv).toEqual([
                "secret-tool",
                "search",
                "--all",
                "service",
                "kb-desktop",
                "account",
                "remote-1",
              ]);
              return Promise.resolve(found);
            },
          }).erase(item),
        ),
      );
    expect(await erase({ code: 0, stdout: "", stderr: "" })).toMatchObject({ success: undefined });
    for (const found of [
      { code: 0, stdout: "[locked-item]\n", stderr: "" },
      { code: 1, stdout: "", stderr: "secret-tool: service unavailable\n" },
    ]) {
      expect(await erase(found)).toMatchObject({
        failure: { message: "secret-tool refused to delete the item" },
      });
    }
    const { asked, run } = recorder({
      code: 1,
      stdout: "",
      stderr: "secret-tool: service unavailable\n",
    });
    expect(
      await Effect.runPromise(
        Effect.result(platformKeychain({ platform: "linux", run }).erase(item)),
      ),
    ).toMatchObject({ failure: { message: "secret-tool refused to delete the item" } });
    expect(asked.map((each) => each.argv[1])).toEqual(["clear"]);
  });

  test("a refused write, a platform with no keychain and a helper that hangs fail with why", async () => {
    const refused = platformKeychain({
      platform: "darwin",
      run: recorder({ code: 1, stdout: "", stderr: "" }).run,
    });
    expect(await Effect.runPromise(Effect.result(refused.write(item, "v")))).toMatchObject({
      failure: { message: "security refused the write" },
    });
    const none = platformKeychain({ platform: "win32" });
    expect(await Effect.runPromise(Effect.result(none.read(item)))).toMatchObject({
      failure: { message: "kb reads no keychain on win32" },
    });
    const hangs = platformKeychain({
      platform: "darwin",
      run: () => new Promise(() => undefined),
      timeoutMs: 20,
    });
    expect(await Effect.runPromise(Effect.result(hangs.erase(item)))).toMatchObject({
      failure: { message: "security did not answer within 0.02s" },
    });
  });
});
