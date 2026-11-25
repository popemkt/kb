/**
 * A `ServerListener` as a person types it: `unix:<path>`, `<host>:<port>` or
 * `[<ipv6>]:<port>`, and whether it can be reached from this machine only.
 */
import { isIPv4, isIPv6 } from "node:net";
import { resolve } from "node:path";
import type { ServerListener } from "@kb/contracts";

/** What an address is, for a message that refuses one. */
const FORMS = "unix:<path>, <host>:<port> or [<ipv6>]:<port>";

/** A TCP port, 0 meaning any free one. */
function portOf(text: string): number | null {
  const port = Number(text);
  return /^\d+$/.test(text) && port <= 65535 ? port : null;
}

/**
 * The listener `text` names, or why it names none. A socket's path is made
 * absolute, as a presence or a message names it for a process in any
 * directory. An IPv6 host is written in brackets and held without them, as
 * `Bun.serve` takes it.
 */
export function listenerOfAddress(text: string): ServerListener | { readonly refused: string } {
  if (text.startsWith("unix:")) {
    const path = text.slice("unix:".length);
    return path === ""
      ? { refused: "unix: needs a path" }
      : { kind: "socket", path: resolve(path) };
  }
  const at = text.lastIndexOf(":");
  const host = text.slice(0, Math.max(at, 0));
  const port = portOf(text.slice(at + 1));
  const bracketed = /^\[(.+)\]$/.exec(host)?.[1];
  const hostname = bracketed ?? host;
  const valid =
    at > 0 &&
    port !== null &&
    (bracketed === undefined ? !hostname.includes(":") : isIPv6(hostname));
  if (!valid) return { refused: `${text} is not an address (${FORMS})` };
  return { kind: "tcp", hostname, port };
}

/**
 * Whether only this machine can reach `at`: a socket (only its owner can,
 * and root), or a TCP port on a loopback address, written as one. A name
 * such as `localhost` is not taken, since what it resolves to is not the
 * address's to say.
 */
export function onThisMachineOnly(at: ServerListener): boolean {
  if (at.kind === "socket") return true;
  if (isIPv4(at.hostname)) return at.hostname.split(".")[0] === "127";
  return isIPv6(at.hostname) && at.hostname === "::1";
}

/** How a request names a loopback TCP listener in its `Host`: its address, and `localhost`. */
export function hostsOf(
  at: Extract<ServerListener, { kind: "tcp" }>,
  port: number,
): readonly [string, string] {
  const address = isIPv6(at.hostname) ? `[${at.hostname}]` : at.hostname;
  return [`${address}:${port}`, `localhost:${port}`];
}
