/**
 * A listener as a person types it (`listenerOfAddress`), whether only this
 * machine reaches it (`onThisMachineOnly`), and the `Host`s that name a TCP
 * one (`hostsOf`).
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { hostsOf, listenerOfAddress, onThisMachineOnly } from "../src/index.ts";

describe("listenerOfAddress", () => {
  test("reads a socket, made absolute, and a TCP host and port, IPv6 in brackets", () => {
    expect(listenerOfAddress("unix:/run/kb/mcp.sock")).toEqual({
      kind: "socket",
      path: "/run/kb/mcp.sock",
    });
    expect(listenerOfAddress("unix:mcp.sock")).toEqual({
      kind: "socket",
      path: resolve("mcp.sock"),
    });
    expect(listenerOfAddress("127.0.0.1:4322")).toEqual({
      kind: "tcp",
      hostname: "127.0.0.1",
      port: 4322,
    });
    expect(listenerOfAddress("[::1]:0")).toEqual({ kind: "tcp", hostname: "::1", port: 0 });
  });

  test("refuses what is no address, saying what one is", () => {
    for (const text of ["unix:", "4322", ":4322", "127.0.0.1", "127.0.0.1:x", "::1:80", "[x]:80"]) {
      expect(listenerOfAddress(text)).toHaveProperty("refused");
    }
    expect(listenerOfAddress("127.0.0.1:70000")).toEqual({
      refused: "127.0.0.1:70000 is not an address (unix:<path>, <host>:<port> or [<ipv6>]:<port>)",
    });
  });
});

/** Whether the listener `text` names is reached from this machine only. */
function reach(text: string): boolean {
  const at = listenerOfAddress(text);
  if ("refused" in at) throw new Error(at.refused);
  return onThisMachineOnly(at);
}

describe("onThisMachineOnly", () => {
  test("holds for a socket and a loopback address written as one, not for a name or another host", () => {
    expect(["unix:/tmp/kb.sock", "127.0.0.1:1", "127.8.0.2:1", "[::1]:1"].map(reach)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      ["0.0.0.0:1", "192.168.1.5:1", "[::]:1", "localhost:1", "kb.example:1"].map(reach),
    ).toEqual([false, false, false, false, false]);
  });
});

test("hostsOf names a TCP listener by its address and by localhost", () => {
  expect(hostsOf({ kind: "tcp", hostname: "127.0.0.1", port: 0 }, 4322)).toEqual([
    "127.0.0.1:4322",
    "localhost:4322",
  ]);
  expect(hostsOf({ kind: "tcp", hostname: "::1", port: 9 }, 9)).toEqual(["[::1]:9", "localhost:9"]);
});
